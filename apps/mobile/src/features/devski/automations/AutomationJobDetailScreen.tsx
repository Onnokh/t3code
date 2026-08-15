import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import {
  useFocusEffect,
  useNavigation,
  type NavigationProp,
  type StaticScreenProps,
} from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { uuidv4 } from "../../../lib/uuid";
import {
  useArmDevskiActivityForAutomationRun,
  useAutomationNotificationOffer,
} from "../notifications/automationNotifications";
import { useAutomationsClient } from "./automations-api";
import {
  availableLifecycleActions,
  deleteBlockedByActiveRun,
  describeDeletionScope,
  suggestDuplicateName,
  type LifecycleAction,
} from "./automations-lifecycle";
import {
  describeRunSummary,
  describeTrigger,
  describeWork,
  isRunActive,
  summarizeError,
  type AutomationJob,
  type AutomationRun,
  type AutomationsResult,
  type AutomationsStackParamList,
} from "./automations-state";
import { CodeBlock, FieldRow, ListRow, PlainButton, SectionTitle } from "./AutomationsUi";

type Params = { readonly jobId: string; readonly name?: string };

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly job: AutomationJob;
      readonly runs: readonly AutomationRun[];
    };

const ACTIVE_POLL_MS = 3_000;

function runLines(run: AutomationRun): string[] {
  const lines = [`${run.cause === "manual" ? "Manual" : "Scheduled"} · ${describeRunSummary(run)}`];
  if (run.exitCode !== undefined) lines.push(`Exit code ${run.exitCode}`);
  if (run.errorSummary) lines.push(run.errorSummary);
  return lines;
}

/**
 * Plain Job detail: the accepted Job fields and current revision, Run Now
 * through the canonical Trigger path, newest-first Run history, and the
 * accepted lifecycle controls (PLO-419): enable, disable, archive,
 * restore, duplicate, and permanent deletion with the typed-name
 * confirmation. Every operation refreshes authoritative server state; no
 * offline mutation is queued.
 */
export function AutomationJobDetailScreen({ route }: StaticScreenProps<Params>) {
  const { jobId } = route.params;
  const navigation = useNavigation<NavigationProp<AutomationsStackParamList>>();
  const client = useAutomationsClient();
  const offerNotifications = useAutomationNotificationOffer();
  const armDevskiActivity = useArmDevskiActivityForAutomationRun();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [mutating, setMutating] = useState<LifecycleAction | null>(null);
  const runNowKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const [jobResult, runsResult] = await Promise.all([
      client.getJob(jobId),
      client.listRuns(jobId),
    ]);
    if (jobResult.kind === "ok" && runsResult.kind === "ok") {
      setState({ kind: "ready", job: jobResult.value, runs: runsResult.value });
    } else {
      setState({
        kind: "error",
        message: summarizeError(jobResult.kind === "ok" ? runsResult : jobResult),
      });
    }
  }, [client, jobId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const hasActiveRun = state.kind === "ready" && Boolean(state.job.activeRunId);
  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = setInterval(() => void load(), ACTIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [hasActiveRun, load]);

  const openRun = useCallback(
    (runId: string) => navigation.navigate("AutomationRun", { runId }),
    [navigation],
  );

  const requestRunNow = useCallback(
    async (job: AutomationJob, confirmDisabled: boolean) => {
      if (!client) return;
      // One key per user intent: a retry after a lost response replays the
      // same Run instead of starting a second one.
      runNowKey.current ??= uuidv4();
      setTriggering(true);
      setBanner(null);
      const result = await client.runNow(job.id, runNowKey.current, confirmDisabled);
      setTriggering(false);
      if (result.kind === "ok") {
        runNowKey.current = null;
        // Show this Run on the unified Devski Activity (best-effort;
        // ActivityKit being unavailable never affects the Run).
        armDevskiActivity({ jobName: job.name, runId: result.value.run.id });
        void load();
        openRun(result.value.run.id);
        return;
      }
      if (result.kind === "pairing-required") {
        setBanner("This Device Session expired or was revoked. Pair this device again.");
        return;
      }
      runNowKey.current = null;
      if (result.error.code === "job_running") {
        const activeRunId = result.error.run?.id;
        Alert.alert(
          "Job already running",
          "This Job already has an active Run. A competing Trigger is rejected rather than queued.",
          activeRunId
            ? [{ text: "OK" }, { text: "View active Run", onPress: () => openRun(activeRunId) }]
            : undefined,
        );
        return;
      }
      setBanner(result.error.message);
    },
    [armDevskiActivity, client, load, openRun],
  );

  const onRunNow = useCallback(
    (job: AutomationJob) => {
      if (job.archivedAt) {
        setBanner("This Job is archived. Restore it before running.");
        return;
      }
      if (!job.enabled && job.trigger.kind !== "manual") {
        // Review confirmation per the remote-action safety policy.
        Alert.alert(
          "Run a disabled Job?",
          `"${job.name}" is disabled for automatic Triggers. Run it once now?`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Run Now", onPress: () => void requestRunNow(job, true) },
          ],
        );
        return;
      }
      void requestRunNow(job, false);
    },
    [requestRunNow],
  );

  /**
   * Runs one lifecycle mutation, then refreshes authoritative server
   * state. There is no offline queue: a failure surfaces immediately and
   * the screen reloads what the server holds.
   */
  const applyLifecycle = useCallback(
    async (
      action: LifecycleAction,
      mutate: () => Promise<AutomationsResult<AutomationJob>>,
    ): Promise<AutomationJob | null> => {
      setMutating(action);
      setBanner(null);
      const result = await mutate();
      // A deleted Job no longer loads; every other outcome refetches.
      if (action !== "delete" || result.kind !== "ok") await load();
      setMutating(null);
      if (result.kind === "ok") return result.value;
      if (result.kind === "pairing-required") {
        setBanner("This Device Session expired or was revoked. Pair this device again.");
        return null;
      }
      if (result.error.code === "revision_conflict") {
        setBanner(
          "This action used an outdated Job Revision. The current Job was reloaded — review it and try again.",
        );
        return null;
      }
      if (result.error.code === "validation_failed" && result.error.fieldErrors?.confirmName) {
        setBanner("The typed name does not match the current Job name. Nothing was deleted.");
        return null;
      }
      setBanner(result.error.message);
      return null;
    },
    [load],
  );

  const onToggleTriggers = useCallback(
    (job: AutomationJob) => {
      if (!client) return;
      // Enable/disable needs no confirmation (remote-action safety policy).
      void applyLifecycle(job.enabled ? "disable" : "enable", () =>
        job.enabled
          ? client.disableJob(job.id, job.revision)
          : client.enableJob(job.id, job.revision),
      ).then((updated) => {
        // Contextual notification onboarding (PLO-420): enabling a
        // scheduled Job is the other moment Automation Notifications
        // become worth offering. One-shot and best-effort.
        if (updated && !job.enabled && updated.enabled) {
          offerNotifications("first_scheduled_job_enabled");
        }
      });
    },
    [applyLifecycle, client, offerNotifications],
  );

  const onArchive = useCallback(
    (job: AutomationJob) => {
      if (!client) return;
      // Archiving is the recoverable path; an active Run continues.
      void applyLifecycle("archive", () => client.archiveJob(job.id, job.revision));
    },
    [applyLifecycle, client],
  );

  const onRestore = useCallback(
    (job: AutomationJob) => {
      if (!client) return;
      void applyLifecycle("restore", () => client.restoreJob(job.id, job.revision));
    },
    [applyLifecycle, client],
  );

  const onDuplicate = useCallback(
    (job: AutomationJob) => {
      if (!client) return;
      Alert.prompt(
        "Duplicate Job",
        "The copy starts disabled and owns no Runs, logs, Artifacts, or Workspace. Name the new Job:",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Duplicate",
            onPress: (name?: string) => {
              const trimmed = name?.trim();
              if (!trimmed) {
                setBanner("A name for the duplicated Job is required.");
                return;
              }
              void applyLifecycle("duplicate", () =>
                client.duplicateJob(job.id, trimmed, uuidv4()),
              ).then((copy) => {
                if (copy) {
                  navigation.navigate("AutomationJob", { jobId: copy.id, name: copy.name });
                }
              });
            },
          },
        ],
        "plain-text",
        suggestDuplicateName(job.name),
      );
    },
    [applyLifecycle, client, navigation],
  );

  const onDelete = useCallback(
    (job: AutomationJob, runCount: number) => {
      if (!client) return;
      // Destructive confirmation (remote-action safety policy): summarize
      // everything that goes away and require typing the exact Job name.
      // The server verifies the typed name, the latest revision, and that
      // no Run is active before removing anything.
      Alert.prompt(
        "Delete Job permanently?",
        describeDeletionScope(job, runCount),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete permanently",
            style: "destructive",
            onPress: (typed?: string) => {
              void applyLifecycle("delete", () =>
                client.deleteJob(job.id, job.revision, typed ?? ""),
              ).then((deleted) => {
                if (deleted) navigation.goBack();
              });
            },
          },
        ],
        "plain-text",
      );
    },
    [applyLifecycle, client, navigation],
  );

  if (!client) {
    return (
      <View className="flex-1 bg-screen px-5 py-5">
        <ErrorBanner message="Pair this device in Code to use Automations." />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 20 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {banner ? <ErrorBanner message={banner} /> : null}
      {state.kind === "loading" ? (
        <Text className="text-sm text-foreground-muted">Loading Job…</Text>
      ) : null}
      {state.kind === "error" ? <ErrorBanner message={state.message} /> : null}
      {state.kind === "ready" ? (
        <>
          <Text className="font-t3-bold text-xl text-foreground">{state.job.name}</Text>
          <FieldRow label="Job ID" value={state.job.id} />
          <FieldRow label="Revision" value={String(state.job.revision)} />
          <FieldRow label="Kind" value={describeWork(state.job.work)} />
          <FieldRow label="Trigger" value={describeTrigger(state.job.trigger)} />
          {state.job.nextRunAt ? (
            <FieldRow label="Next Run" value={new Date(state.job.nextRunAt).toLocaleString()} />
          ) : null}
          <FieldRow
            label="Automatic Triggers"
            value={state.job.archivedAt ? "Archived" : state.job.enabled ? "Enabled" : "Disabled"}
          />
          <FieldRow label="Timeout" value={`${state.job.timeoutMinutes} min`} />
          {state.job.repository ? (
            <FieldRow label="Repository" value={state.job.repository.url} />
          ) : null}
          {state.job.work.kind === "agent" && state.job.work.model ? (
            <FieldRow label="Model" value={state.job.work.model} />
          ) : null}
          <FieldRow
            label="Secret References"
            value={state.job.secretRefs.length > 0 ? state.job.secretRefs.join(", ") : "None"}
          />
          <FieldRow label="Created" value={new Date(state.job.createdAt).toLocaleString()} />
          <FieldRow label="Updated" value={new Date(state.job.updatedAt).toLocaleString()} />
          {state.job.archivedAt ? (
            <FieldRow label="Archived" value={new Date(state.job.archivedAt).toLocaleString()} />
          ) : null}

          <SectionTitle>{state.job.work.kind === "agent" ? "Prompt" : "Command"}</SectionTitle>
          <CodeBlock
            text={state.job.work.kind === "agent" ? state.job.work.prompt : state.job.work.command}
          />

          <View className="mt-3 gap-2">
            <PlainButton
              label="Edit Job"
              disabled={Boolean(state.job.archivedAt)}
              onPress={() => navigation.navigate("AutomationJobEditor", { jobId: state.job.id })}
            />
            {state.job.activeRunId ? (
              <PlainButton
                label="View active Run"
                onPress={() => openRun(state.job.activeRunId ?? "")}
              />
            ) : null}
            <PlainButton
              label={triggering ? "Requesting Run…" : "Run Now"}
              disabled={
                triggering ||
                mutating !== null ||
                Boolean(state.job.activeRunId) ||
                Boolean(state.job.archivedAt)
              }
              onPress={() => onRunNow(state.job)}
            />
          </View>

          <SectionTitle>Lifecycle</SectionTitle>
          {(() => {
            const actions = availableLifecycleActions(state.job);
            const busy = mutating !== null || triggering;
            const deleteBlocked = deleteBlockedByActiveRun(state.job);
            const job = state.job;
            const runCount = state.runs.length;
            return (
              <View className="gap-2">
                {actions.includes("enable") ? (
                  <PlainButton
                    label={mutating === "enable" ? "Enabling…" : "Enable automatic Triggers"}
                    disabled={busy}
                    onPress={() => onToggleTriggers(job)}
                  />
                ) : null}
                {actions.includes("disable") ? (
                  <PlainButton
                    label={mutating === "disable" ? "Disabling…" : "Disable automatic Triggers"}
                    disabled={busy}
                    onPress={() => onToggleTriggers(job)}
                  />
                ) : null}
                {actions.includes("archive") ? (
                  <PlainButton
                    label={mutating === "archive" ? "Archiving…" : "Archive Job"}
                    disabled={busy}
                    onPress={() => onArchive(job)}
                  />
                ) : null}
                {actions.includes("restore") ? (
                  <PlainButton
                    label={mutating === "restore" ? "Restoring…" : "Restore Job"}
                    disabled={busy}
                    onPress={() => onRestore(job)}
                  />
                ) : null}
                <PlainButton
                  label={mutating === "duplicate" ? "Duplicating…" : "Duplicate Job"}
                  disabled={busy}
                  onPress={() => onDuplicate(job)}
                />
                <PlainButton
                  label={mutating === "delete" ? "Deleting…" : "Delete Job permanently"}
                  destructive
                  disabled={busy || deleteBlocked}
                  onPress={() => onDelete(job, runCount)}
                />
                {deleteBlocked ? (
                  <Text className="text-xs text-foreground-muted">
                    Permanent deletion waits until no Run is active. Stop the active Run first.
                  </Text>
                ) : null}
              </View>
            );
          })()}

          <SectionTitle>Run history</SectionTitle>
          {state.runs.length === 0 ? (
            <Text className="text-sm text-foreground-muted">This Job never ran.</Text>
          ) : (
            state.runs.map((run) => (
              <ListRow
                key={run.id}
                title={`Run ${run.id.slice(0, 8)}${isRunActive(run.state) ? " (active)" : ""}`}
                lines={runLines(run)}
                onPress={() => openRun(run.id)}
              />
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
