import { describe, expect, it } from "vite-plus/test";

import type { AutomationJob, RunState } from "../automations/automations-state";
import {
  ARMED_RUN_GRACE_MS,
  automationActivityPhase,
  automationActivityRuns,
  buildAutomationActivityProps,
  decideAutomationActivity,
  type AutomationActivityRun,
} from "./automation-activity";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

function makeRun(overrides: Partial<AutomationActivityRun> = {}): AutomationActivityRun {
  return {
    runId: "run-1",
    jobName: "Nightly SEO sweep",
    state: "running",
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: "job-1",
    revision: 1,
    name: "Nightly SEO sweep",
    work: { kind: "command", command: "sleevy-seo run" },
    trigger: { kind: "manual" },
    timeoutMinutes: 30,
    enabled: true,
    secretRefs: [],
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("automationActivityPhase", () => {
  it("maps every Run state onto a phase the Activity renders", () => {
    const phases: Record<RunState, string> = {
      pending: "starting",
      running: "running",
      succeeded: "succeeded",
      failed: "failed",
      timed_out: "timed_out",
      cancelled: "cancelled",
      legacy: "stale",
    };
    for (const [state, phase] of Object.entries(phases)) {
      expect(automationActivityPhase(state as RunState)).toBe(phase);
    }
  });
});

describe("buildAutomationActivityProps", () => {
  it("labels an armed Run the way the Gateway's first update will", () => {
    const props = buildAutomationActivityProps({
      runs: [makeRun({ state: "pending" })],
      now: new Date(NOW).toISOString(),
    });
    expect(props.activeCount).toBe(1);
    expect(props.subtitle).toBe("1 Automation Run");
    expect(props.activities).toEqual([
      {
        source: "automation",
        environmentId: "automations",
        threadId: "run-1",
        projectTitle: "Automation",
        threadTitle: "Nightly SEO sweep",
        modelTitle: "Run",
        phase: "starting",
        status: "Starting",
        updatedAt: new Date(NOW).toISOString(),
        deepLink: "/automations/runs/run-1",
      },
    ]);
  });

  it("leads with active Runs, then the most recent outcomes", () => {
    const props = buildAutomationActivityProps({
      runs: [
        makeRun({ runId: "old", state: "failed", updatedAt: new Date(NOW - 60_000).toISOString() }),
        makeRun({ runId: "new", state: "succeeded", updatedAt: new Date(NOW).toISOString() }),
        makeRun({ runId: "live", state: "running" }),
      ],
      now: new Date(NOW).toISOString(),
    });
    expect(props.activities.map((row) => row.threadId)).toEqual(["live", "new", "old"]);
    expect(props.activeCount).toBe(1);
  });
});

describe("automationActivityRuns", () => {
  it("reads one row per Job that ever ran", () => {
    const runs = automationActivityRuns([
      makeJob({
        id: "job-1",
        latestRun: {
          id: "run-1",
          state: "failed",
          requestedAt: new Date(NOW - 5_000).toISOString(),
          startedAt: new Date(NOW - 4_000).toISOString(),
          finishedAt: new Date(NOW - 3_000).toISOString(),
        },
      }),
      makeJob({ id: "job-2", name: "Never ran" }),
    ]);
    expect(runs).toEqual([
      {
        runId: "run-1",
        jobName: "Nightly SEO sweep",
        state: "failed",
        updatedAt: new Date(NOW - 3_000).toISOString(),
      },
    ]);
  });

  it("times a Run that has not finished by whatever it last reached", () => {
    const runs = automationActivityRuns([
      makeJob({
        activeRunId: "run-1",
        latestRun: {
          id: "run-1",
          state: "running",
          requestedAt: new Date(NOW - 5_000).toISOString(),
          startedAt: new Date(NOW - 4_000).toISOString(),
        },
      }),
    ]);
    expect(runs[0]?.updatedAt).toBe(new Date(NOW - 4_000).toISOString());
  });
});

describe("decideAutomationActivity", () => {
  it("keeps the card while any Run is still going", () => {
    for (const state of ["pending", "running"] as const) {
      expect(decideAutomationActivity({ armed: [], runs: [makeRun({ state })], now: NOW })).toEqual(
        { kind: "keep" },
      );
    }
  });

  it("ends the card on every terminal outcome, not only success", () => {
    for (const state of ["succeeded", "failed", "timed_out", "cancelled", "legacy"] as const) {
      expect(decideAutomationActivity({ armed: [], runs: [makeRun({ state })], now: NOW })).toEqual(
        { kind: "end" },
      );
    }
  });

  it("ends a card that outlived the process that armed it", () => {
    expect(decideAutomationActivity({ armed: [], runs: [], now: NOW })).toEqual({ kind: "end" });
  });

  it("keeps a Run the Gateway has not published yet", () => {
    expect(
      decideAutomationActivity({
        armed: [{ runId: "run-2", armedAt: NOW - 1_000 }],
        runs: [makeRun({ runId: "run-1", state: "failed" })],
        now: NOW,
      }),
    ).toEqual({ kind: "keep" });
  });

  it("stops waiting for an armed Run the Gateway never publishes", () => {
    expect(
      decideAutomationActivity({
        armed: [{ runId: "run-2", armedAt: NOW - ARMED_RUN_GRACE_MS }],
        runs: [makeRun({ runId: "run-1", state: "failed" })],
        now: NOW,
      }),
    ).toEqual({ kind: "end" });
  });

  it("ends once an armed Run is published as terminal", () => {
    expect(
      decideAutomationActivity({
        armed: [{ runId: "run-1", armedAt: NOW - 1_000 }],
        runs: [makeRun({ runId: "run-1", state: "failed" })],
        now: NOW,
      }),
    ).toEqual({ kind: "end" });
  });

  it("keeps the card when another Job is still running", () => {
    expect(
      decideAutomationActivity({
        armed: [],
        runs: [makeRun({ runId: "run-1", state: "failed" }), makeRun({ runId: "run-2" })],
        now: NOW,
      }),
    ).toEqual({ kind: "keep" });
  });
});
