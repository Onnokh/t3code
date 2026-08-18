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
 * Devski never asks for notification permission at first launch. The offer
 * happens once, after real Automation use proves the value:
 *   - the first observed successful Run Now, or
 *   - enabling the first scheduled Job.
 *
 * On grant, the device's APNs token is registered with the Devski Gateway
 * (`PUT /api/devski/v1/notifications/registration`) using the same Device
 * Session bearer as every other Devski call. The Gateway binds the token
 * to the Device Session server-side; APNs credentials never reach the
 * phone. A denied permission is recorded and never re-prompted — the
 * permission state then lives in iOS Settings.
 */

export type AutomationNotificationTrigger =
  | "first_successful_run_now"
  | "first_scheduled_job_enabled";

export type AutomationNotificationOfferOutcome =
  | "registered"
  | "permission_denied"
  | "already_offered"
  | "unavailable";

export type AutomationNotificationDeps = {
  readonly wasOffered: () => Promise<boolean>;
  readonly markOffered: () => Promise<void>;
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
 * The one-shot contextual offer. Ordering is deliberate: the offered
 * marker is written before any prompt outcome is known, so a crash or a
 * dismissed dialog can never turn the contextual moment into repeated
 * prompting.
 */
export async function offerAutomationNotifications(
  deps: AutomationNotificationDeps,
): Promise<AutomationNotificationOfferOutcome> {
  if (await deps.wasOffered()) return "already_offered";
  await deps.markOffered();

  const permission = await deps.requestPermission();
  if (permission === "unsupported") return "unavailable";
  if (permission === "denied") return "permission_denied";

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
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const bearerToken = connection?.bearerToken ?? null;
  const httpBaseUrl = connection?.httpBaseUrl ?? null;

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
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const bearerToken = connection?.bearerToken ?? null;
  const httpBaseUrl = connection?.httpBaseUrl ?? null;

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
 * Returns the fire-and-forget contextual offer for the Automations
 * screens. It resolves the paired environment the same way the
 * Automations client does; while unpaired the offer is inert.
 */
export function useAutomationNotificationOffer(): (trigger: AutomationNotificationTrigger) => void {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const bearerToken = connection?.bearerToken ?? null;
  const httpBaseUrl = connection?.httpBaseUrl ?? null;

  return useCallback(
    (_trigger: AutomationNotificationTrigger) => {
      if (!bearerToken || !httpBaseUrl) return;
      void offerAutomationNotifications({
        wasOffered: async () => (await loadPreferences()).automationNotificationsOffered === true,
        markOffered: async () => {
          await savePreferencesPatch({ automationNotificationsOffered: true });
        },
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
