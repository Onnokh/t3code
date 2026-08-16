import { describe, expect, it } from "vite-plus/test";

import {
  describeJobSchedule,
  describeRunSummary,
  describeTrigger,
  formatByteLength,
  interpretAutomationsResponse,
  isRunActive,
  readJobs,
  readLog,
  readModels,
  readRun,
  readTriggerResult,
  splitJobs,
  summarizeError,
  type AutomationJob,
} from "./automations-state";

const job: AutomationJob = {
  id: "5a1f8d1e-1111-4222-8333-444455556666",
  revision: 3,
  name: "daily-report",
  work: { kind: "command", command: "generate-report" },
  trigger: { kind: "recurring", cron: "0 9 * * *", timezone: "Europe/Amsterdam" },
  timeoutMinutes: 30,
  enabled: true,
  secretRefs: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  nextRunAt: "2026-08-16T07:00:00.000Z",
  latestRun: {
    id: "run-1",
    state: "succeeded",
    requestedAt: "2026-08-15T07:00:00.000Z",
    finishedAt: "2026-08-15T07:01:00.000Z",
  },
};

describe("interpretAutomationsResponse", () => {
  it("accepts a Job list from the Gateway", () => {
    const result = interpretAutomationsResponse(
      { kind: "response", status: 200, body: { jobs: [job], requestId: "r-1" } },
      readJobs,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value).toEqual([job]);
  });

  it("fails closed on an expired or revoked Device Session", () => {
    const result = interpretAutomationsResponse(
      { kind: "response", status: 401, body: null },
      readJobs,
    );
    expect(result.kind).toBe("pairing-required");
    expect(summarizeError(result)).toContain("Pair this device again");
  });

  it("surfaces the contract error with the active Run on job_running", () => {
    const result = interpretAutomationsResponse(
      {
        kind: "response",
        status: 409,
        body: {
          code: "job_running",
          message: "This Job already has an active Run.",
          requestId: "r-2",
          run: { id: "run-active", state: "running" },
        },
      },
      readTriggerResult,
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error.code).toBe("job_running");
    expect(result.error.run?.id).toBe("run-active");
    expect(result.error.requestId).toBe("r-2");
  });

  it("treats a malformed success payload as an unavailable service", () => {
    const result = interpretAutomationsResponse(
      { kind: "response", status: 200, body: { unexpected: true } },
      readRun,
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error.code).toBe("automations_unavailable");
  });

  it("treats a network failure as an unavailable service", () => {
    const result = interpretAutomationsResponse({ kind: "network-error" }, readJobs);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error.code).toBe("automations_unavailable");
  });

  it("reads a bounded resumable log chunk", () => {
    const result = interpretAutomationsResponse(
      {
        kind: "response",
        status: 200,
        body: {
          log: {
            text: "hello\n",
            nextCursor: "abc.def",
            complete: false,
            truncated: false,
            retainedBytes: 6,
          },
        },
      },
      readLog,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.text).toBe("hello\n");
    expect(result.value.nextCursor).toBe("abc.def");
    expect(result.value.complete).toBe(false);
  });
});

describe("Automations display helpers", () => {
  it("splits active and archived Jobs", () => {
    const archived = { ...job, id: "job-2", archivedAt: "2026-08-10T00:00:00.000Z" };
    const { active, archived: archivedJobs } = splitJobs([job, archived]);
    expect(active.map((entry) => entry.id)).toEqual([job.id]);
    expect(archivedJobs.map((entry) => entry.id)).toEqual(["job-2"]);
  });

  it("describes schedule state honestly", () => {
    expect(describeJobSchedule(job)).toContain("Next Run");
    expect(describeJobSchedule({ ...job, enabled: false })).toBe("Disabled");
    expect(describeJobSchedule({ ...job, archivedAt: "2026-08-10T00:00:00.000Z" })).toContain(
      "Archived",
    );
    expect(describeJobSchedule({ ...job, trigger: { kind: "manual" } })).toBe("Manual only");
  });

  it("describes Triggers and Run summaries", () => {
    expect(
      describeTrigger({ kind: "recurring", cron: "0 9 * * *", timezone: "Europe/Amsterdam" }),
    ).toBe("Recurring 0 9 * * * (Europe/Amsterdam)");
    expect(describeTrigger({ kind: "manual" })).toBe("Manual only");
    expect(describeRunSummary(undefined)).toBe("Never ran");
    expect(describeRunSummary(job.latestRun)).toContain("Succeeded");
  });

  it("classifies active Run states", () => {
    expect(isRunActive("pending")).toBe(true);
    expect(isRunActive("running")).toBe(true);
    expect(isRunActive("succeeded")).toBe(false);
    expect(isRunActive("cancelled")).toBe(false);
  });

  it("keeps one row per model id, so the picker can tell its choices apart", () => {
    const catalog = readModels({
      serverVersion: "1.4.0",
      defaultModel: "opencode-go/deepseek-v4-flash",
      models: [
        { id: "openai/gpt-5.4", providerID: "openai", modelID: "gpt-5.4", name: "GPT-5.4" },
        { id: "openai/gpt-5.4", providerID: "gitlab", modelID: "gpt-5.4", name: "GPT-5.4 (Duo)" },
        { id: "anthropic/opus-5", providerID: "anthropic", modelID: "opus-5", name: "Opus 5" },
      ],
    });
    expect(catalog?.models.map((model) => model.name)).toEqual(["GPT-5.4", "Opus 5"]);
    expect(catalog?.defaultModel).toBe("opencode-go/deepseek-v4-flash");
  });

  it("rejects a catalog without a server version or a model list", () => {
    expect(readModels({ models: [] })).toBe(null);
    expect(readModels({ serverVersion: "1.4.0" })).toBe(null);
  });

  it("formats Artifact byte lengths", () => {
    expect(formatByteLength(512)).toBe("512 B");
    expect(formatByteLength(2_048)).toBe("2.0 kB");
    expect(formatByteLength(3 * 1_024 * 1_024)).toBe("3.0 MB");
  });
});
