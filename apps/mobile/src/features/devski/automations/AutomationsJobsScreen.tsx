import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { automationActivityRuns } from "../notifications/automation-activity";
import { settleDevskiActivityForAutomationRuns } from "../notifications/automationNotifications";
import { automationsCacheKeys, useAutomationsClient } from "./automations-api";
import { readDevskiCacheEntry, writeDevskiCacheEntry } from "../devski-read-cache";
import {
  describeJobSchedule,
  describeRunSummary,
  describeWork,
  splitJobs,
  type AutomationJob,
  type AutomationsStackParamList,
} from "./automations-state";
import { NativeHeaderToolbar } from "../../../native/StackHeader";
import { ListRow, SectionTitle } from "./AutomationsUi";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly jobs: readonly AutomationJob[] };

function jobLines(job: AutomationJob): string[] {
  const lines = [describeWork(job.work), describeJobSchedule(job)];
  if (job.activeRunId) lines.push(`Active Run ${job.activeRunId}`);
  lines.push(`Latest: ${describeRunSummary(job.latestRun)}`);
  return lines;
}

/**
 * Plain Automations home: every active and archived Job with its next,
 * active, and latest Run state, plus entry into the Job editor for
 * creation. Lifecycle controls (PLO-419) live on the Job detail screen.
 */
export function AutomationsJobsScreen() {
  const navigation = useNavigation<NavigationProp<AutomationsStackParamList>>();
  const client = useAutomationsClient();
  const [state, setState] = useState<LoadState>(() => {
    const cached = readDevskiCacheEntry<readonly AutomationJob[]>(automationsCacheKeys.jobs);
    return cached === null ? { kind: "loading" } : { kind: "ready", jobs: cached };
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    const result = await client.listJobs();
    if (result.kind === "ok") {
      writeDevskiCacheEntry(automationsCacheKeys.jobs, result.value);
      setState({ kind: "ready", jobs: result.value });
      // This list is exactly what tells the Devski Activity whether any
      // Run is still going, so settle the card from the read that just
      // landed rather than asking the Gateway a second time.
      void settleDevskiActivityForAutomationRuns(automationActivityRuns(result.value));
    } else if (result.kind === "pairing-required") {
      setState({
        kind: "error",
        message: "This Device Session expired or was revoked. Pair this device again.",
      });
    } else setState({ kind: "error", message: result.error.message });
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!client) {
    return (
      <View className="flex-1 bg-screen">
        <EmptyState
          variant="plain"
          title="Pair this device"
          detail="Pair this device in Code to browse Harness Jobs and Runs."
        />
      </View>
    );
  }

  const { active, archived } =
    state.kind === "ready" ? splitJobs(state.jobs) : { active: [], archived: [] };

  return (
    <>
      {/* Authoring a Job is the Area's compose action, so it sits in the
          navigation bar where a new thread does, not on top of the list. */}
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel="New Job"
          icon="square.and.pencil"
          onPress={() => navigation.navigate("AutomationJobEditor", undefined)}
          separateBackground
        />
      </NativeHeaderToolbar>
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
        {state.kind === "loading" ? (
          <Text className="text-sm text-foreground-muted">Loading Jobs…</Text>
        ) : null}
        {state.kind === "error" ? <ErrorBanner message={state.message} /> : null}
        {state.kind === "ready" ? (
          <>
            <SectionTitle>Active Jobs</SectionTitle>
            {active.length === 0 ? (
              <Text className="text-sm text-foreground-muted">No active Jobs.</Text>
            ) : (
              active.map((job) => (
                <ListRow
                  key={job.id}
                  title={job.name}
                  lines={jobLines(job)}
                  onPress={() =>
                    navigation.navigate("AutomationJob", { jobId: job.id, name: job.name })
                  }
                />
              ))
            )}
            <SectionTitle>Archived Jobs</SectionTitle>
            {archived.length === 0 ? (
              <Text className="text-sm text-foreground-muted">No archived Jobs.</Text>
            ) : (
              archived.map((job) => (
                <ListRow
                  key={job.id}
                  title={job.name}
                  lines={jobLines(job)}
                  onPress={() =>
                    navigation.navigate("AutomationJob", { jobId: job.id, name: job.name })
                  }
                />
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
