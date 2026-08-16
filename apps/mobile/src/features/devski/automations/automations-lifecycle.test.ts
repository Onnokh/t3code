import { describe, expect, it } from "vite-plus/test";

import {
  availableLifecycleActions,
  deleteBlockedByActiveRun,
  describeDeletionScope,
  suggestDuplicateName,
} from "./automations-lifecycle";
import type { AutomationJob } from "./automations-state";

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
};

describe("availableLifecycleActions", () => {
  it("offers disable, archive, duplicate, and delete on an enabled scheduled Job", () => {
    expect(availableLifecycleActions(job)).toEqual(["disable", "archive", "duplicate", "delete"]);
  });

  it("offers enable instead of disable on a Disabled Job", () => {
    expect(availableLifecycleActions({ ...job, enabled: false })).toEqual([
      "enable",
      "archive",
      "duplicate",
      "delete",
    ]);
  });

  it("offers no Trigger toggle on a manual-only Job", () => {
    expect(availableLifecycleActions({ ...job, trigger: { kind: "manual" } })).toEqual([
      "archive",
      "duplicate",
      "delete",
    ]);
  });

  it("offers restore, duplicate, and delete on an Archived Job", () => {
    expect(availableLifecycleActions({ ...job, archivedAt: "2026-08-14T00:00:00.000Z" })).toEqual([
      "restore",
      "duplicate",
      "delete",
    ]);
  });
});

describe("deleteBlockedByActiveRun", () => {
  it("blocks permanent deletion while a Run is active", () => {
    expect(deleteBlockedByActiveRun(job)).toBe(false);
    expect(deleteBlockedByActiveRun({ ...job, activeRunId: "run-1" })).toBe(true);
  });
});

describe("suggestDuplicateName", () => {
  it("suggests a distinct name because active names are unique", () => {
    expect(suggestDuplicateName("daily-report")).toBe("daily-report copy");
  });
});

describe("describeDeletionScope", () => {
  it("summarizes the Job, Workspace, Runs, logs, and Artifacts that go away", () => {
    const summary = describeDeletionScope(job, 2);
    expect(summary).toContain('"daily-report"');
    expect(summary).toContain("Workspace");
    expect(summary).toContain("2 recorded Runs");
    expect(summary).toContain("Artifacts");
    expect(summary).toContain("cannot be undone");
    expect(describeDeletionScope(job, 1)).toContain("1 recorded Run,");
  });
});
