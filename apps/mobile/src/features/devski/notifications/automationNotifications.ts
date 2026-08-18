import { useCallback, useEffect } from "react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { runtime } from "../../../lib/runtime";
import {
  loadOrCreateAgentAwarenessDeviceId,
  loadPreferences,
  savePreferencesPatch,
} from "../../../persistence/imperative";
import { useSavedRemoteConnection } from "../../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../../state/workspace";
import { addActivityTokenListener, addPushToStartTokenListener } from "expo-widgets";

import AgentActivity from "../../../widgets/AgentActivity";
import { supportsAgentAwarenessPush } from "../../agent-awareness/capabilities";
import { requestAgentNotificationPermission } from "../../agent-awareness/notificationPermissions";
import { resolveApsEnvironment } from "../../agent-awareness/registrationPayload";

/**
 * Contextual Automation Notification onboarding (PLO-420).
 *
 * Devski never asks for notification permission at first launch. The
 * prompt happens once, after real Automation use proves the value:
 *   - the first observed successful Run Now, or
 *   - enabling the first scheduled Job.
 *
 * On grant, the device's APNs token is registered with the Devski Gateway
 * (`PUT /api/devski/v1/notifications/registration`) using the same Device
 * Session bearer as every other Devski call. The Gateway binds the token
 * to the Device Session server-side; APNs credentials never reach the
 * phone. A denied permission is left to iOS Settings, never re-prompted.
 *
 * Being asked and holding a token are two different things, and conflating
 * them is what kept this device silent for good: the offered marker
 * guarded the whole offer, so an install that had been asked once could
 * never obtain a token afterwards, whatever went wrong the first time. The
 * marker now guards only the prompt. Registration happens wherever
 * permission already exists — the offer re-entered after a grant, and
 * `useDevskiAlertTokenRegistration` at launch and on foreground — because
 * none of those paths put a dialog in front of anyone.
 */

export type AutomationNotificationTrigger =
  | "first_successful_run_now"
  | "first_scheduled_job_enabled";

export type AutomationNotificationOfferOutcome =
  | "registered"
  | "permission_denied"
  | "already_offered"
  | "unavailable";

export type NotificationPermissionStatus = "granted" | "denied" | "undetermined" | "unsupported";

export type AutomationNotificationDeps = {
  readonly wasOffered: () => Promise<boolean>;
  readonly markOffered: () => Promise<void>;
  /** Reads iOS's answer without asking the owner for one. */
  readonly permissionStatus: () => Promise<NotificationPermissionStatus>;
  readonly requestPermission: () => Promise<"granted" | "denied" | "unsupported">;
  readonly readPushToken: () => Promise<string | null>;
  readonly register: (input: {
    readonly deviceId: string;
    readonly pushToken: string;
    readonly apsEnvironment: "sandbox" | "production";
  }) => Promise<boolean>;
  readonly deviceId: () => Promise<string>;
  readonly apsEnvironment: "sandbox" | "production";
};

/**
 * The contextual offer, and the only place in Devski that may prompt.
 *
 * iOS is asked first, because its answer decides whether continuing costs
 * the owner anything. A granted permission means everything below runs
 * silently, so the offered marker has no say over it — that is what lets a
 * device offered notifications long ago, holding no token because the read
 * or the registration failed at the time, still reach a registered state.
 * A denied one stops here for good: reversing it is an iOS Settings
 * decision, not something to re-ask.
 *
 * Only an undetermined permission can raise a dialog, and that is exactly
 * where the marker applies. Ordering inside it is unchanged and
 * deliberate: the marker is written before any outcome is known, so a
 * crash or a dialog the owner never answers cannot turn the contextual
 * moment into repeated prompting.
 */
export async function offerAutomationNotifications(
  deps: AutomationNotificationDeps,
): Promise<AutomationNotificationOfferOutcome> {
  const status = await deps.permissionStatus();
  if (status === "unsupported") return "unavailable";
  if (status === "denied") return "permission_denied";

  if (status === "undetermined") {
    if (await deps.wasOffered()) return "already_offered";
    await deps.markOffered();

    const permission = await deps.requestPermission();
    if (permission === "unsupported") return "unavailable";
    if (permission === "denied") return "permission_denied";
  }

  const pushToken = await deps.readPushToken();
  if (!pushToken) return "unavailable";
  const registered = await deps.register({
    deviceId: await deps.deviceId(),
    pushToken,
    apsEnvironment: deps.apsEnvironment,
  });
  return registered ? "registered" : "unavailable";
}

/**
 * Registers this device's APNs token with the Devski Gateway. The bearer
 * authenticates the Device Session; the response deliberately carries no
 * token material back.
 */
export async function registerAutomationNotificationsWithGateway(input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly deviceId: string;
  readonly pushToken: string;
  readonly apsEnvironment: "sandbox" | "production";
  readonly fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const origin = input.httpBaseUrl.replace(/\/$/, "");
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${origin}/api/devski/v1/notifications/registration`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${input.bearerToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId: input.deviceId,
          pushToken: input.pushToken,
          apsEnvironment: input.apsEnvironment,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Registers this device's push-to-start token with the Gateway, which is
 * what lets a Run create the Devski Activity while Devski is closed. It is
 * the only token that exists before a card does; the activity token below
 * belongs to a card that is already live, and APNs silently ignores a
 * start sent to it.
 *
 * The token is issued by iOS per install and rotates on its own schedule,
 * so this is called whenever ActivityKit hands one over rather than at a
 * particular moment in the UI.
 */
export async function registerPushToStartTokenWithGateway(input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly deviceId: string;
  readonly pushToStartToken: string;
  readonly apsEnvironment: "sandbox" | "production";
  readonly fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const origin = input.httpBaseUrl.replace(/\/$/, "");
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${origin}/api/devski/v1/notifications/registration`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${input.bearerToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId: input.deviceId,
          pushToStartToken: input.pushToStartToken,
          apsEnvironment: input.apsEnvironment,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Registers the armed Devski Activity's push token with the Gateway so
 * Harness Run lifecycle events can update the Live Activity remotely.
 */
export async function registerLiveActivityTokenWithGateway(input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly deviceId: string;
  readonly activityPushToken: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const origin = input.httpBaseUrl.replace(/\/$/, "");
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${origin}/api/devski/v1/notifications/live-activities`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.bearerToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId: input.deviceId,
          activityPushToken: input.activityPushToken,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Hands the Gateway the push token of every Live Activity on this device,
 * including one the Gateway started itself while Devski was closed.
 *
 * A remotely started card gets a *new* activity push token, issued to the
 * app rather than to the server, and updates and `end` can only be
 * delivered to it. So a card the server created is frozen until the app
 * next runs and registers it. This is the closing of that loop, and it is
 * why a Run that starts while Devski is closed shows its opening state
 * promptly but catches up on the rest when the app is next opened.
 */
async function registerLiveActivityTokens(input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}): Promise<void> {
  if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return;
  const preferences = await loadPreferences().catch(() => null);
  if (preferences?.liveActivitiesEnabled === false) return;

  const deviceId = await loadOrCreateAgentAwarenessDeviceId();
  const register = async (activityPushToken: string) => {
    await registerLiveActivityTokenWithGateway({
      httpBaseUrl: input.httpBaseUrl,
      bearerToken: input.bearerToken,
      deviceId,
      activityPushToken,
    });
  };

  for (const activity of AgentActivity.getInstances()) {
    try {
      const token = await activity.getPushToken();
      if (token) {
        await register(token);
        continue;
      }
      // Not issued yet: iOS delivers it shortly after the card appears.
      activity.addPushTokenListener((event) => {
        if (event.pushToken) void register(event.pushToken).catch(() => {});
      });
    } catch {
      // A card that vanished between listing and reading is not an error.
    }
  }
}

/** Reports one card-scoped token, wherever it came from. */
async function registerActivityPushToken(input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly activityPushToken: string;
}): Promise<void> {
  if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return;
  const preferences = await loadPreferences().catch(() => null);
  if (preferences?.liveActivitiesEnabled === false) return;
  const deviceId = await loadOrCreateAgentAwarenessDeviceId();
  await registerLiveActivityTokenWithGateway({
    httpBaseUrl: input.httpBaseUrl,
    bearerToken: input.bearerToken,
    deviceId,
    activityPushToken: input.activityPushToken,
  });
}

/**
 * The Device Session every registration below travels on. Devski resolves
 * it the way the Automations client does — the connected environment, else
 * the first paired one — so a token is never reported to an environment
 * the app is not actually talking to. While unpaired there is nothing to
 * report to and every caller stays inert.
 */
function useDevskiGatewayConnection(): {
  readonly bearerToken: string | null;
  readonly httpBaseUrl: string | null;
} {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  return {
    bearerToken: connection?.bearerToken ?? null,
    httpBaseUrl: connection?.httpBaseUrl ?? null,
  };
}

/**
 * Keeps the Gateway able to reach whatever card is on this device.
 *
 * Devski deliberately no longer starts a card when a Run is triggered from
 * the foreground. The Gateway starts it, for every Run and not only the
 * ones triggered while the app happened to be open — and two starters
 * would mean two cards for the same work.
 *
 * It does not end one either. Reporting tokens is the whole of this
 * device's part in the card's lifetime: the Gateway computes `start`,
 * `update` and `end` from the aggregate it owns, and that aggregate holds
 * rows from producers this device cannot see — the API and MCP callers
 * write their own rows beside the Harness's. Devski once ended every
 * instance whenever Automation state left nothing to follow, which read as
 * a safety valve and behaved as a second owner: an API-pushed card died
 * about a second after it appeared, because no Automation Run explained
 * it. Ending only cards attributable to Runs was the tempting narrowing
 * and still leaves two opinions about when one shared resource dies, so
 * the app now has none.
 *
 * Scanning at launch and on foreground is not enough on its own. A card
 * the Gateway starts while the app is away gets a fresh, card-scoped token
 * from iOS, and only this device can report it. Without it the Gateway
 * keeps addressing the previous card: APNs answers 200, iOS discards the
 * push because that activity is gone, and the new card sits on its opening
 * state until someone opens the app. So the listener runs continuously and
 * the foreground scan stays as a catch-up for whatever it missed while the
 * process was not running.
 */
export function useDevskiActivityTokenRegistration(): void {
  const { bearerToken, httpBaseUrl } = useDevskiGatewayConnection();

  useEffect(() => {
    if (!bearerToken || !httpBaseUrl) return;
    const run = () => {
      void registerLiveActivityTokens({ httpBaseUrl, bearerToken }).catch(() => {});
    };
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    // Fires for every activity on the device, including one the system
    // started from a push while this process was not running.
    const tokens = addActivityTokenListener((event) => {
      if (!event.pushToken) return;
      void registerActivityPushToken({
        httpBaseUrl,
        bearerToken,
        activityPushToken: event.pushToken,
      }).catch(() => {});
    });
    return () => {
      subscription.remove();
      tokens.remove();
    };
  }, [bearerToken, httpBaseUrl]);
}

/**
 * Hands this device's push-to-start token to the Gateway, and every
 * rotation of it after that. Without this the Gateway can update a card
 * the app already created but can never create one itself, so a Run
 * triggered from the Harness while Devski is closed stays invisible.
 *
 * iOS emits the token when ActivityKit is ready rather than on request,
 * which is why this listens for the life of the shell instead of asking
 * once at a convenient moment.
 */
export function useDevskiPushToStartRegistration(): void {
  const { bearerToken, httpBaseUrl } = useDevskiGatewayConnection();

  useEffect(() => {
    if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return;
    if (!bearerToken || !httpBaseUrl) return;

    let cancelled = false;
    const register = async (pushToStartToken: string) => {
      if (cancelled || pushToStartToken.trim().length === 0) return;
      const preferences = await loadPreferences().catch(() => null);
      if (preferences?.liveActivitiesEnabled === false) return;
      await registerPushToStartTokenWithGateway({
        httpBaseUrl,
        bearerToken,
        deviceId: await loadOrCreateAgentAwarenessDeviceId(),
        pushToStartToken,
        apsEnvironment: resolveApsEnvironment(Constants.expoConfig?.extra?.appVariant),
      });
    };

    const subscription = addPushToStartTokenListener((event) => {
      void register(event.activityPushToStartToken).catch(() => {});
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [bearerToken, httpBaseUrl]);
}

async function readNativePushToken(): Promise<string | null> {
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return token?.type === "ios" && typeof token.data === "string" && token.data.trim().length > 0
      ? token.data.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * What iOS already knows, read rather than asked. `undetermined` is the
 * one status that means a dialog would appear, and it is the reason this is
 * a separate call from requesting: the request cannot report what it would
 * have cost before it costs it.
 *
 * A read that throws is reported as unsupported rather than undetermined,
 * because guessing "nobody has been asked" is the guess that prompts.
 */
async function readNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (Platform.OS !== "ios") return "unsupported";
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.granted) return "granted";
    return permissions.status === "undetermined" ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

/**
 * Keeps the Gateway holding an alert token for this device whenever iOS
 * permission allows one, without ever asking for that permission here.
 *
 * The contextual offer is the only prompt, and it fires at most once in the
 * life of an install. Everything that can go wrong after the owner says yes
 * — a token read that fails, a Gateway that is unreachable for the minute
 * the offer runs, a re-pair that gives the Gateway a new Device Session and
 * loses the token bound to the old one — used to be unrecoverable, because
 * the offered marker had already been spent. Registration is idempotent
 * (the Gateway upserts by device) and silent, so the honest fix is to do it
 * on every launch and foreground rather than to remember having done it: a
 * remembered flag would be this device's guess about server state, which is
 * the thing that was wrong in the first place.
 *
 * The token listener is here for its own reason. APNs can roll a device
 * token while the app runs, and it issues the first one shortly after
 * permission is granted — including a grant made from Settings, which no
 * foreground event follows.
 */
export function useDevskiAlertTokenRegistration(): void {
  const { bearerToken, httpBaseUrl } = useDevskiGatewayConnection();

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!bearerToken || !httpBaseUrl) return;

    let cancelled = false;
    const register = async (pushToken: string | null) => {
      if (cancelled) return;
      if ((await readNotificationPermissionStatus()) !== "granted") return;
      const token = pushToken ?? (await readNativePushToken());
      if (cancelled || !token) return;
      await registerAutomationNotificationsWithGateway({
        httpBaseUrl,
        bearerToken,
        deviceId: await loadOrCreateAgentAwarenessDeviceId(),
        pushToken: token,
        apsEnvironment: resolveApsEnvironment(Constants.expoConfig?.extra?.appVariant),
      });
    };

    void register(null).catch(() => {});
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void register(null).catch(() => {});
    });
    const tokens = Notifications.addPushTokenListener((token) => {
      if (token.type !== "ios" || typeof token.data !== "string") return;
      void register(token.data.trim()).catch(() => {});
    });
    return () => {
      cancelled = true;
      appState.remove();
      tokens.remove();
    };
  }, [bearerToken, httpBaseUrl]);
}

/**
 * Returns the fire-and-forget contextual offer for the Automations
 * screens. It resolves the paired environment the same way the
 * Automations client does; while unpaired the offer is inert.
 */
export function useAutomationNotificationOffer(): (trigger: AutomationNotificationTrigger) => void {
  const { bearerToken, httpBaseUrl } = useDevskiGatewayConnection();

  return useCallback(
    (_trigger: AutomationNotificationTrigger) => {
      if (!bearerToken || !httpBaseUrl) return;
      void offerAutomationNotifications({
        wasOffered: async () => (await loadPreferences()).automationNotificationsOffered === true,
        markOffered: async () => {
          await savePreferencesPatch({ automationNotificationsOffered: true });
        },
        permissionStatus: readNotificationPermissionStatus,
        requestPermission: async () => {
          const exit = await runtime.runPromiseExit(requestAgentNotificationPermission);
          if (exit._tag !== "Success") return "unsupported";
          return exit.value.type === "granted"
            ? "granted"
            : exit.value.type === "denied"
              ? "denied"
              : "unsupported";
        },
        readPushToken: readNativePushToken,
        register: (input) =>
          registerAutomationNotificationsWithGateway({
            httpBaseUrl,
            bearerToken,
            ...input,
          }),
        deviceId: () => loadOrCreateAgentAwarenessDeviceId(),
        apsEnvironment: resolveApsEnvironment(Constants.expoConfig?.extra?.appVariant),
      }).catch(() => {
        // The offer is strictly best-effort: Automations stays fully
        // usable without notification permission.
      });
    },
    [bearerToken, httpBaseUrl],
  );
}
