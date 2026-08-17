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
import AgentActivity from "../../../widgets/AgentActivity";
import { supportsAgentAwarenessPush } from "../../agent-awareness/capabilities";
import { requestAgentNotificationPermission } from "../../agent-awareness/notificationPermissions";
import { resolveApsEnvironment } from "../../agent-awareness/registrationPayload";
import { useAutomationsClient, type AutomationsClient } from "../automations/automations-api";
import { isRunActive, type RunState } from "../automations/automations-state";
import {
  automationActivityRuns,
  buildAutomationActivityProps,
  decideAutomationActivity,
  type AutomationActivityRun,
} from "./automation-activity";

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
 * Runs this device armed the Activity for, kept for the life of the
 * process only. They exist to stop a reconciliation that overtakes the
 * Gateway from ending a card armed moments ago; after a relaunch an empty
 * set is the right answer, because a card that outlived the process that
 * armed it has nothing pending.
 */
const armedAutomationRuns = new Map<string, number>();

/**
 * Arms the unified Devski Activity for a foreground-triggered Automation
 * Run and hands its push token to the Gateway. If Code work already armed
 * the activity, its token is reused instead of starting a second card —
 * one aggregate presents both sources. Best-effort: Live Activities being
 * disabled, unsupported, or at the system limit never affects the Run.
 */
async function armDevskiActivityForAutomationRun(input: {
  readonly jobName: string;
  readonly runId: string;
  readonly runState: RunState;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}): Promise<void> {
  if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return;
  // The Harness can fail a Run in milliseconds, so a Trigger can come back
  // already terminal. That Run has nothing left to follow, and arming for
  // it would only put a card on the Lock Screen that is stale on arrival.
  if (!isRunActive(input.runState)) return;
  const preferences = await loadPreferences().catch(() => null);
  if (preferences?.liveActivitiesEnabled === false) return;

  const registerToken = async (activityPushToken: string) => {
    await registerLiveActivityTokenWithGateway({
      httpBaseUrl: input.httpBaseUrl,
      bearerToken: input.bearerToken,
      deviceId: await loadOrCreateAgentAwarenessDeviceId(),
      activityPushToken,
    });
  };

  try {
    const nowIso = new Date().toISOString();
    armedAutomationRuns.set(input.runId, Date.now());
    const activity =
      AgentActivity.getInstances()[0] ??
      AgentActivity.start(
        buildAutomationActivityProps({
          runs: [
            {
              runId: input.runId,
              jobName: input.jobName,
              state: input.runState,
              updatedAt: nowIso,
            },
          ],
          now: nowIso,
        }),
      );
    const token = await activity.getPushToken();
    if (token) {
      await registerToken(token);
      return;
    }
    activity.addPushTokenListener((event) => {
      if (event.pushToken) void registerToken(event.pushToken);
    });
  } catch {
    // ActivityKit refused (disabled, unsupported, or at the system
    // limit). The Gateway's alert fallback still covers failures.
  }
}

/**
 * Returns the best-effort Devski Activity arming callback for a Run that
 * was just accepted from the foreground.
 */
export function useArmDevskiActivityForAutomationRun(): (input: {
  readonly jobName: string;
  readonly runId: string;
  readonly runState: RunState;
}) => void {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const bearerToken = connection?.bearerToken ?? null;
  const httpBaseUrl = connection?.httpBaseUrl ?? null;

  return useCallback(
    (input: { readonly jobName: string; readonly runId: string; readonly runState: RunState }) => {
      if (!bearerToken || !httpBaseUrl) return;
      void armDevskiActivityForAutomationRun({ ...input, httpBaseUrl, bearerToken }).catch(
        () => {},
      );
    },
    [bearerToken, httpBaseUrl],
  );
}

/**
 * Ends the Devski Activity once the observed Runs leave it nothing to
 * follow. This is the way out the Gateway cannot provide: it only ever
 * pushes `update`, so without this a failed, timed out, or cancelled Run
 * keeps its card on the Lock Screen for hours. The dismissal is immediate
 * — a failure is already delivered as its own alert, and an ended card
 * that lingers would still occupy the one aggregate the next Run needs.
 */
export async function settleDevskiActivityForAutomationRuns(
  runs: readonly AutomationActivityRun[],
  now = Date.now(),
): Promise<void> {
  if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return;
  const decision = decideAutomationActivity({
    armed: [...armedAutomationRuns].map(([runId, armedAt]) => ({ runId, armedAt })),
    runs,
    now,
  });
  if (decision.kind === "keep") return;
  armedAutomationRuns.clear();
  try {
    await Promise.all(AgentActivity.getInstances().map((activity) => activity.end("immediate")));
  } catch {
    // ActivityKit is unavailable or the card is already gone; either way
    // there is nothing left on the Lock Screen to end.
  }
}

/**
 * Reconciles the Devski Activity against authoritative Job state. A read
 * that fails changes nothing: an unreachable Gateway is not evidence that
 * a Run finished.
 */
export async function reconcileDevskiActivity(client: AutomationsClient): Promise<void> {
  const result = await client.listJobs();
  if (result.kind !== "ok") return;
  await settleDevskiActivityForAutomationRuns(automationActivityRuns(result.value));
}

/**
 * Keeps the Devski Activity from outliving its Runs anywhere in the app.
 * A Run usually finishes while Devski is closed or on another screen, so
 * the card is reconciled at launch and on every foreground rather than
 * only where Automations happen to be on screen.
 */
export function useDevskiActivityReconciliation(): void {
  const client = useAutomationsClient();

  useEffect(() => {
    if (!client) return;
    void reconcileDevskiActivity(client);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reconcileDevskiActivity(client);
    });
    return () => subscription.remove();
  }, [client]);
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
