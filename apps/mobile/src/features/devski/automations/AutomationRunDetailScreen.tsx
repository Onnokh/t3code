import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, Share, View } from "react-native";
import { useFocusEffect, type StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { uuidv4 } from "../../../lib/uuid";
import { useAutomationNotificationOffer } from "../notifications/automationNotifications";
import { useAutomationsClient } from "./automations-api";
import {
  describeRunState,
  formatByteLength,
  isRunActive,
  summarizeError,
  type ArtifactSummary,
  type AutomationRun,
} from "./automations-state";
import { CodeBlock, FieldRow, ListRow, PlainButton, SectionTitle } from "./AutomationsUi";

type Params = { readonly runId: string };

const ACTIVE_POLL_MS = 2_000;
const LOG_CHUNK_BYTES = 65_536;
const MAX_VISIBLE_LOG_CHARS = 200_000;

type LogFollow = {
  readonly text: string;
  readonly cursor: string | null;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly trimmed: boolean;
};

const EMPTY_LOG: LogFollow = {
  text: "",
  cursor: null,
  complete: false,
  truncated: false,
  trimmed: false,
};

/**
 * Plain Run detail: resumable state, sanitized log following, Stop for an
 * active Run, and declared Artifact metadata with safe download.
 */
export function AutomationRunDetailScreen({ route }: StaticScreenProps<Params>) {
  const { runId } = route.params;
  const client = useAutomationsClient();
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [log, setLog] = useState<LogFollow>(EMPTY_LOG);
  const [artifacts, setArtifacts] = useState<readonly ArtifactSummary[]>([]);
  const [stopping, setStopping] = useState(false);
  const stopKey = useRef<string | null>(null);
  const logBusy = useRef(false);
  const logCursor = useRef<string | null>(null);

  const loadRun = useCallback(async () => {
    if (!client) return;
    const result = await client.getRun(runId);
    if (result.kind === "ok") {
      setRun(result.value);
      setError(null);
      if (result.value.artifacts) setArtifacts(result.value.artifacts);
    } else {
      setError(summarizeError(result));
    }
  }, [client, runId]);

  const followLog = useCallback(async () => {
    if (!client || logBusy.current) return;
    logBusy.current = true;
    try {
      // Bounded reads with the server's opaque cursor: any range can be
      // requested again after reconnection, so a retry never duplicates.
      for (let chunk = 0; chunk < 8; chunk += 1) {
        const cursor = logCursor.current;
        const result = await client.readRunLog(runId, {
          ...(cursor ? { cursor } : {}),
          limit: LOG_CHUNK_BYTES,
        });
        if (result.kind !== "ok") return;
        const read = result.value;
        logCursor.current = read.nextCursor;
        setLog((current) => {
          const combined = current.text + read.text;
          const trimmed = combined.length > MAX_VISIBLE_LOG_CHARS;
          return {
            text: trimmed ? combined.slice(combined.length - MAX_VISIBLE_LOG_CHARS) : combined,
            cursor: read.nextCursor,
            complete: read.complete,
            truncated: read.truncated,
            trimmed: current.trimmed || trimmed,
          };
        });
        if (read.complete || read.text.length === 0) return;
      }
    } finally {
      logBusy.current = false;
    }
  }, [client, runId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadRun(), followLog()]);
  }, [loadRun, followLog]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );

  const active = run !== null && isRunActive(run.state);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      void loadRun();
      void followLog();
    }, ACTIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [active, loadRun, followLog]);

  // A terminal Run may still owe us the log tail and Artifact list.
  const terminal = run !== null && !isRunActive(run.state) && run.state !== "legacy";
  useEffect(() => {
    if (!terminal || !client) return;
    void followLog();
    void client.listArtifacts(runId).then((result) => {
      if (result.kind === "ok") setArtifacts(result.value);
    });
  }, [terminal, client, runId, followLog]);

  // Contextual notification onboarding (PLO-420): the first observed
  // successful Run is the moment Automation Notifications become worth
  // offering. The offer is one-shot and best-effort.
  const offerNotifications = useAutomationNotificationOffer();
  const succeeded = run?.state === "succeeded";
  useEffect(() => {
    if (succeeded) offerNotifications("first_successful_run_now");
  }, [succeeded, offerNotifications]);

  const requestStop = useCallback(async () => {
    if (!client) return;
    stopKey.current ??= uuidv4();
    setStopping(true);
    setBanner(null);
    const result = await client.cancelRun(runId, stopKey.current);
    setStopping(false);
    if (result.kind === "ok") {
      setRun(result.value.run);
      void loadRun();
      return;
    }
    stopKey.current = null;
    setBanner(summarizeError(result));
  }, [client, runId, loadRun]);

  const onStop = useCallback(() => {
    // Review confirmation per the remote-action safety policy: Stop is
    // idempotent server-side and targets exactly this Run ID.
    Alert.alert(
      "Stop this Run?",
      "The Harness requests graceful termination and escalates when necessary.",
      [
        { text: "Keep running", style: "cancel" },
        { text: "Stop Run", style: "destructive", onPress: () => void requestStop() },
      ],
    );
  }, [requestStop]);

  const downloadArtifact = useCallback(
    async (artifact: ArtifactSummary) => {
      if (!client) return;
      setBanner(null);
      const result = await client.fetchArtifact(runId, artifact.id);
      if (result.kind === "error") {
        setBanner(result.message);
        return;
      }
      try {
        const { File, Paths } = await import("expo-file-system");
        const safeName = artifact.name.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
        const file = new File(Paths.cache, safeName);
        if (file.exists) file.delete();
        file.create();
        file.write(result.bytes);
        await Share.share({ url: file.uri });
      } catch {
        setBanner("Could not save the downloaded Artifact on this device.");
      }
    },
    [client, runId],
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
            void loadAll().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {banner ? <ErrorBanner message={banner} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {run === null && !error ? (
        <Text className="text-sm text-foreground-muted">Loading Run…</Text>
      ) : null}
      {run ? (
        <>
          <Text className="font-t3-bold text-xl text-foreground">
            {run.job} · {describeRunState(run.state)}
          </Text>
          <FieldRow label="Run ID" value={run.id} />
          <FieldRow
            label="Cause"
            value={run.cause === "manual" ? "Manual Trigger" : "Scheduled Trigger"}
          />
          <FieldRow label="Requested" value={new Date(run.requestedAt).toLocaleString()} />
          {run.startedAt ? (
            <FieldRow label="Started" value={new Date(run.startedAt).toLocaleString()} />
          ) : null}
          {run.finishedAt ? (
            <FieldRow label="Finished" value={new Date(run.finishedAt).toLocaleString()} />
          ) : null}
          {run.durationMs !== undefined ? (
            <FieldRow label="Duration" value={`${Math.round(run.durationMs / 1000)}s`} />
          ) : null}
          {run.exitCode !== undefined ? (
            <FieldRow label="Exit code" value={String(run.exitCode)} />
          ) : null}
          {run.errorSummary ? <FieldRow label="Error" value={run.errorSummary} /> : null}

          {isRunActive(run.state) ? (
            <View className="mt-2">
              <PlainButton
                destructive
                label={stopping ? "Stopping…" : "Stop Run"}
                disabled={stopping}
                onPress={onStop}
              />
            </View>
          ) : null}

          <SectionTitle>Log</SectionTitle>
          {log.trimmed ? (
            <Text className="text-sm text-foreground-muted">
              Older log output is hidden on this device.
            </Text>
          ) : null}
          {log.truncated ? (
            <Text className="text-sm text-foreground-muted">
              The server truncated this log at its retention limit.
            </Text>
          ) : null}
          {log.text.length > 0 ? (
            <CodeBlock text={log.text} />
          ) : (
            <Text className="text-sm text-foreground-muted">
              {isRunActive(run.state) ? "Waiting for log output…" : "No log output is available."}
            </Text>
          )}
          {!log.complete && log.cursor && !isRunActive(run.state) ? (
            <PlainButton label="Load more log output" onPress={() => void followLog()} />
          ) : null}

          <SectionTitle>Artifacts</SectionTitle>
          {artifacts.length === 0 ? (
            <Text className="text-sm text-foreground-muted">This Run declared no Artifacts.</Text>
          ) : (
            artifacts.map((artifact) => (
              <ListRow
                key={artifact.id}
                title={artifact.name}
                lines={[
                  `${artifact.mediaType} · ${formatByteLength(artifact.byteLength)}`,
                  `Created ${new Date(artifact.createdAt).toLocaleString()}`,
                  "Tap to download and share.",
                ]}
                onPress={() => void downloadArtifact(artifact)}
              />
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
