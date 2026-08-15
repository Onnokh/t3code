import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_TIMEZONE,
  commandReviewLines,
  cronFromDraft,
  draftFromJob,
  draftToDefinition,
  emptyDraft,
  needsCommandReview,
  recurrenceFromCron,
  toggleSecretRef,
  type JobDefinitionInput,
} from "./automations-authoring";
import type { AutomationJob } from "./automations-state";

const NOW = new Date("2026-08-15T12:00:00.000Z");

const commandJob: AutomationJob = {
  id: "5a1f8d1e-1111-4222-8333-444455556666",
  revision: 3,
  name: "daily-report",
  work: { kind: "command", command: "generate-report" },
  trigger: { kind: "recurring", cron: "30 9 * * *", timezone: "Europe/Amsterdam" },
  timeoutMinutes: 45,
  enabled: true,
  secretRefs: ["github-token"],
  repository: { url: "https://github.com/org/repo.git" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const agentJob: AutomationJob = {
  ...commandJob,
  id: "6b2f8d1e-2222-4222-8333-444455556666",
  name: "nightly-notes",
  work: { kind: "agent", prompt: "Summarize the day", model: "opencode/alpha" },
  trigger: { kind: "oneShot", runAt: "2026-09-01T09:00:00+02:00", timezone: "Europe/Amsterdam" },
  secretRefs: [],
};

describe("draft defaults and Job round-trips", () => {
  it("starts with the contract defaults", () => {
    const draft = emptyDraft();
    expect(draft.kind).toBe("agent");
    expect(draft.triggerKind).toBe("manual");
    expect(draft.timezone).toBe(DEFAULT_TIMEZONE);
    expect(draft.timeoutMinutes).toBe("30");
  });

  it("reopens a recurring Command Job with its friendly recurrence", () => {
    const draft = draftFromJob(commandJob);
    expect(draft.kind).toBe("command");
    expect(draft.command).toBe("generate-report");
    expect(draft.triggerKind).toBe("recurring");
    expect(draft.recurrencePreset).toBe("daily");
    expect(draft.recurrenceTime).toBe("09:30");
    expect(draft.cron).toBe("30 9 * * *");
    expect(draft.timeoutMinutes).toBe("45");
    expect(draft.repositoryUrl).toBe("https://github.com/org/repo.git");
    expect(draft.secretRefs).toEqual(["github-token"]);
  });

  it("reopens a one-shot Agent Job with its model and instant", () => {
    const draft = draftFromJob(agentJob);
    expect(draft.kind).toBe("agent");
    expect(draft.prompt).toBe("Summarize the day");
    expect(draft.model).toBe("opencode/alpha");
    expect(draft.triggerKind).toBe("oneShot");
    expect(draft.runAt).toBe("2026-09-01T09:00:00+02:00");
  });
});

describe("friendly recurrence and the advanced cron field", () => {
  it("derives cron from the friendly presets", () => {
    const base = emptyDraft();
    expect(cronFromDraft({ ...base, recurrencePreset: "hourly", recurrenceTime: "00:15" })).toBe(
      "15 * * * *",
    );
    expect(cronFromDraft({ ...base, recurrencePreset: "daily", recurrenceTime: "09:30" })).toBe(
      "30 9 * * *",
    );
    expect(
      cronFromDraft({
        ...base,
        recurrencePreset: "weekly",
        recurrenceTime: "08:00",
        recurrenceWeekday: 2,
      }),
    ).toBe("0 8 * * 2");
    expect(cronFromDraft({ ...base, recurrencePreset: "custom", cron: "*/5 * * * *" })).toBe(
      "*/5 * * * *",
    );
    expect(
      cronFromDraft({ ...base, recurrencePreset: "daily", recurrenceTime: "nope" }),
    ).toBeNull();
  });

  it("maps stored cron back onto the presets and keeps the rest custom", () => {
    expect(recurrenceFromCron("15 * * * *")).toEqual({
      preset: "hourly",
      time: "00:15",
      weekday: 1,
    });
    expect(recurrenceFromCron("30 9 * * *")).toEqual({
      preset: "daily",
      time: "09:30",
      weekday: 1,
    });
    expect(recurrenceFromCron("0 8 * * 2")).toEqual({
      preset: "weekly",
      time: "08:00",
      weekday: 2,
    });
    expect(recurrenceFromCron("*/5 * * * *").preset).toBe("custom");
  });
});

describe("draftToDefinition", () => {
  it("builds an Agent Job definition and omits a blank model for the server default", () => {
    const check = draftToDefinition(
      { ...emptyDraft(), name: " nightly-notes ", prompt: "Summarize the day", model: "  " },
      NOW,
    );
    expect(check.kind).toBe("ok");
    if (check.kind !== "ok") return;
    expect(check.definition.name).toBe("nightly-notes");
    expect(check.definition.work).toEqual({ kind: "agent", prompt: "Summarize the day" });
    expect(check.definition.trigger).toEqual({ kind: "manual" });
    expect(check.definition.timeoutMinutes).toBe(30);
  });

  it("builds a recurring Command Job definition from the friendly controls", () => {
    const check = draftToDefinition(
      {
        ...emptyDraft("command"),
        name: "daily-report",
        command: "generate-report",
        triggerKind: "recurring",
        recurrencePreset: "daily",
        recurrenceTime: "09:30",
        secretRefs: ["github-token"],
      },
      NOW,
    );
    expect(check.kind).toBe("ok");
    if (check.kind !== "ok") return;
    expect(check.definition.work).toEqual({ kind: "command", command: "generate-report" });
    expect(check.definition.trigger).toEqual({
      kind: "recurring",
      cron: "30 9 * * *",
      timezone: "Europe/Amsterdam",
    });
    expect(check.definition.secretRefs).toEqual(["github-token"]);
  });

  it("reports the empty, past, and out-of-bounds fields", () => {
    const check = draftToDefinition(
      {
        ...emptyDraft("command"),
        name: "",
        command: " ",
        triggerKind: "oneShot",
        runAt: "2020-01-01T00:00:00Z",
        timeoutMinutes: "0",
        repositoryUrl: "ftp://example.com/repo.git",
      },
      NOW,
    );
    expect(check.kind).toBe("invalid");
    if (check.kind !== "invalid") return;
    expect(check.errors.name).toBeDefined();
    expect(check.errors.command).toBeDefined();
    expect(check.errors.runAt).toBeDefined();
    expect(check.errors.timeoutMinutes).toBeDefined();
    expect(check.errors.repositoryUrl).toBeDefined();
  });
});

describe("the authority-bearing command review", () => {
  const definition: JobDefinitionInput = {
    name: "daily-report",
    work: { kind: "command", command: "generate-report" },
    trigger: { kind: "manual" },
    timeoutMinutes: 30,
    secretRefs: ["github-token"],
  };

  it("requires review when creating a Command Job or changing its command", () => {
    expect(needsCommandReview(definition, null)).toBe(true);
    expect(
      needsCommandReview(
        { ...definition, work: { kind: "command", command: "generate-report --all" } },
        commandJob,
      ),
    ).toBe(true);
    // A Job that becomes a Command Job carries a new command.
    expect(needsCommandReview(definition, agentJob)).toBe(true);
  });

  it("skips review for Agent Jobs and unchanged commands", () => {
    expect(
      needsCommandReview(
        { ...definition, work: { kind: "agent", prompt: "Summarize the day" } },
        null,
      ),
    ).toBe(false);
    expect(needsCommandReview(definition, commandJob)).toBe(false);
  });

  it("shows the exact command, repository, schedule, timeout, and Secret Reference names", () => {
    const lines = commandReviewLines({
      ...definition,
      repository: { url: "https://github.com/org/repo.git" },
      trigger: { kind: "recurring", cron: "30 9 * * *", timezone: "Europe/Amsterdam" },
    });
    expect(lines).toEqual([
      "Command: generate-report",
      "Repository: https://github.com/org/repo.git",
      "Schedule: Recurring 30 9 * * * (Europe/Amsterdam)",
      "Timeout: 30 min",
      "Secret References: github-token",
    ]);
  });
});

describe("toggleSecretRef", () => {
  it("selects and deselects a Secret Reference by name", () => {
    expect(toggleSecretRef([], "github-token")).toEqual(["github-token"]);
    expect(toggleSecretRef(["github-token"], "github-token")).toEqual([]);
    expect(toggleSecretRef(["github-token"], "ranksta-key")).toEqual([
      "github-token",
      "ranksta-key",
    ]);
  });
});
