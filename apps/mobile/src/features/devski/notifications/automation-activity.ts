import type {
  AgentActivityPhase,
  AgentActivityProps,
  AgentActivityRowProps,
} from "../../../widgets/AgentActivity";
import { isRunActive, type AutomationJob, type RunState } from "../automations/automations-state";

/**
 * The Devski Activity's lifecycle rules for Automation Runs.
 *
 * The Devski Gateway publishes every Run lifecycle event as a Live
 * Activity `update` and has no "end" delivery, so an armed Activity
 * outlives the Run it was armed for: a Run that fails in milliseconds
 * leaves its card on the Lock Screen until iOS's own multi-hour limit,
 * and a Run that finishes before its Activity token reaches the Gateway
 * leaves one that never even says what happened. Devski therefore decides
 * here, from authoritative Automations state, when the card is done.
 */

/** One row of the Activity: a Job's most recent Run. */
export type AutomationActivityRun = {
  readonly runId: string;
  readonly jobName: string;
  readonly state: RunState;
  readonly updatedAt: string;
};

/**
 * A Run this device armed the Activity for. The Gateway learns of a Run
 * through the Harness outbox, so one accepted seconds ago may not be in
 * the Job list yet; while it is this young, its absence means "not
 * published", never "finished".
 */
export type ArmedAutomationRun = {
  readonly runId: string;
  readonly armedAt: number;
};

export const ARMED_RUN_GRACE_MS = 60_000;

const MAX_ACTIVITY_ROWS = 5;

type AutomationPhase = Extract<
  AgentActivityPhase,
  "starting" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "stale"
>;

const STATUS_TEXT: Record<AutomationPhase, string> = {
  starting: "Starting",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
  stale: "No recorded outcome",
};

export function automationActivityPhase(state: RunState): AutomationPhase {
  if (state === "pending") return "starting";
  if (state === "legacy") return "stale";
  return state;
}

export function automationActivityRow(run: AutomationActivityRun): AgentActivityRowProps {
  const phase = automationActivityPhase(run.state);
  return {
    source: "automation",
    environmentId: "automations",
    threadId: run.runId,
    projectTitle: "Automation",
    threadTitle: run.jobName,
    modelTitle: "Run",
    phase,
    status: STATUS_TEXT[phase],
    updatedAt: run.updatedAt,
    deepLink: `/automations/runs/${run.runId}`,
  };
}

/**
 * The content state for a set of Runs, in the shape the Gateway pushes,
 * so a card armed on this device and the first update to reach it never
 * disagree about wording or ordering. Active Runs lead, then the most
 * recent outcomes.
 */
export function buildAutomationActivityProps(input: {
  readonly runs: readonly AutomationActivityRun[];
  readonly now: string;
}): AgentActivityProps {
  const ordered = [...input.runs].sort((a, b) => {
    if (isRunActive(a.state) !== isRunActive(b.state)) return isRunActive(a.state) ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  const activeCount = ordered.filter((run) => isRunActive(run.state)).length;
  return {
    title: "Devski",
    subtitle: activeCount === 1 ? "1 Automation Run" : `${activeCount} Automation Runs`,
    activeCount,
    updatedAt: input.now,
    activities: ordered.slice(0, MAX_ACTIVITY_ROWS).map(automationActivityRow),
  };
}

/**
 * The Runs the Activity should reflect, read from the Job list. A Job
 * accepts at most one active Run, so its latest Run is also its active
 * one whenever it has any — the latest Run alone answers whether that Job
 * still has work on the card.
 */
export function automationActivityRuns(
  jobs: readonly AutomationJob[],
): readonly AutomationActivityRun[] {
  return jobs.flatMap((job) =>
    job.latestRun
      ? [
          {
            runId: job.latestRun.id,
            jobName: job.name,
            state: job.latestRun.state,
            updatedAt:
              job.latestRun.finishedAt ?? job.latestRun.startedAt ?? job.latestRun.requestedAt,
          },
        ]
      : [],
  );
}

export type AutomationActivityDecision = { readonly kind: "keep" } | { readonly kind: "end" };

/**
 * Whether the Devski Activity still has a Run to follow. It ends only
 * when the server reports every Run finished *and* every Run this device
 * armed it for has actually been seen there, so a reconciliation that
 * overtakes the Gateway can never end a card armed a moment ago.
 */
export function decideAutomationActivity(input: {
  readonly armed: readonly ArmedAutomationRun[];
  readonly runs: readonly AutomationActivityRun[];
  readonly now: number;
}): AutomationActivityDecision {
  if (input.runs.some((run) => isRunActive(run.state))) return { kind: "keep" };
  const published = new Set(input.runs.map((run) => run.runId));
  const awaited = input.armed.some(
    (run) => !published.has(run.runId) && input.now - run.armedAt < ARMED_RUN_GRACE_MS,
  );
  return awaited ? { kind: "keep" } : { kind: "end" };
}
