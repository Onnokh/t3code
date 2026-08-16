/**
 * Pure authoring logic for the plain Job editor (PLO-418). The draft is the
 * editable form state; `draftToDefinition` turns it into the typed contract
 * definition or reports field problems before anything reaches the server.
 * The server stays authoritative for full validation (cron semantics, IANA
 * timezone, Secret Reference availability, name uniqueness, revisions).
 */

import type { AutomationJob, JobTrigger, JobWork } from "./automations-state";

/** The typed definition body sent to POST /jobs and PUT /jobs/{id}. */
export type JobDefinitionInput = {
  readonly name: string;
  readonly work: JobWork;
  readonly trigger: JobTrigger;
  readonly repository?: { readonly url: string };
  readonly timeoutMinutes: number;
  readonly secretRefs: readonly string[];
};

export type RecurrencePreset = "hourly" | "daily" | "weekly" | "custom";

export type JobDraft = {
  readonly kind: "agent" | "command";
  readonly name: string;
  readonly prompt: string;
  readonly command: string;
  /** Empty string keeps the OpenCode server-side default model. */
  readonly model: string;
  readonly triggerKind: "manual" | "oneShot" | "recurring";
  readonly recurrencePreset: RecurrencePreset;
  /** "HH:MM" used by the daily and weekly presets; minute for hourly. */
  readonly recurrenceTime: string;
  /** 0 (Sunday) through 6 (Saturday), used by the weekly preset. */
  readonly recurrenceWeekday: number;
  /** Advanced cron text; authoritative when the preset is "custom". */
  readonly cron: string;
  readonly timezone: string;
  /** Absolute one-shot instant as an ISO-8601 string. */
  readonly runAt: string;
  readonly timeoutMinutes: string;
  readonly repositoryUrl: string;
  readonly secretRefs: readonly string[];
};

export const DEFAULT_TIMEZONE = "Europe/Amsterdam";
export const DEFAULT_TIMEOUT_MINUTES = 30;
export const TIMEZONE_CHOICES = ["Europe/Amsterdam", "UTC"] as const;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function emptyDraft(kind: JobDraft["kind"] = "agent"): JobDraft {
  return {
    kind,
    name: "",
    prompt: "",
    command: "",
    model: "",
    triggerKind: "manual",
    recurrencePreset: "daily",
    recurrenceTime: "09:00",
    recurrenceWeekday: 1,
    cron: "",
    timezone: DEFAULT_TIMEZONE,
    runAt: "",
    timeoutMinutes: String(DEFAULT_TIMEOUT_MINUTES),
    repositoryUrl: "",
    secretRefs: [],
  };
}

/**
 * Maps a stored cron expression back onto the friendly presets so an edited
 * Job reopens with the same minimal controls it was authored with. Anything
 * unrecognized stays "custom" with the advanced cron field authoritative.
 */
export function recurrenceFromCron(cron: string): {
  readonly preset: RecurrencePreset;
  readonly time: string;
  readonly weekday: number;
} {
  const hourly = /^(\d{1,2}) \* \* \* \*$/.exec(cron);
  if (hourly?.[1] !== undefined && Number(hourly[1]) < 60) {
    return { preset: "hourly", time: `00:${hourly[1].padStart(2, "0")}`, weekday: 1 };
  }
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
  if (
    daily?.[1] !== undefined &&
    daily[2] !== undefined &&
    Number(daily[1]) < 60 &&
    Number(daily[2]) < 24
  ) {
    return {
      preset: "daily",
      time: `${daily[2].padStart(2, "0")}:${daily[1].padStart(2, "0")}`,
      weekday: 1,
    };
  }
  const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(cron);
  if (
    weekly?.[1] !== undefined &&
    weekly[2] !== undefined &&
    weekly[3] !== undefined &&
    Number(weekly[1]) < 60 &&
    Number(weekly[2]) < 24
  ) {
    return {
      preset: "weekly",
      time: `${weekly[2].padStart(2, "0")}:${weekly[1].padStart(2, "0")}`,
      weekday: Number(weekly[3]),
    };
  }
  return { preset: "custom", time: "09:00", weekday: 1 };
}

export function draftFromJob(job: AutomationJob): JobDraft {
  const base = emptyDraft(job.work.kind);
  const recurrence =
    job.trigger.kind === "recurring"
      ? recurrenceFromCron(job.trigger.cron)
      : {
          preset: base.recurrencePreset,
          time: base.recurrenceTime,
          weekday: base.recurrenceWeekday,
        };
  return {
    ...base,
    name: job.name,
    prompt: job.work.kind === "agent" ? job.work.prompt : "",
    command: job.work.kind === "command" ? job.work.command : "",
    model: job.work.kind === "agent" ? (job.work.model ?? "") : "",
    triggerKind: job.trigger.kind,
    recurrencePreset: recurrence.preset,
    recurrenceTime: recurrence.time,
    recurrenceWeekday: recurrence.weekday,
    cron: job.trigger.kind === "recurring" ? job.trigger.cron : "",
    timezone: job.trigger.kind === "manual" ? DEFAULT_TIMEZONE : job.trigger.timezone,
    runAt: job.trigger.kind === "oneShot" ? job.trigger.runAt : "",
    timeoutMinutes: String(job.timeoutMinutes),
    repositoryUrl: job.repository?.url ?? "",
    secretRefs: job.secretRefs,
  };
}

function parseTime(time: string): { readonly hour: number; readonly minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match?.[1] || match[2] === undefined) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Derives the cron expression for the friendly recurring presets. */
export function cronFromDraft(draft: JobDraft): string | null {
  if (draft.recurrencePreset === "custom") {
    return draft.cron.trim().length > 0 ? draft.cron.trim() : null;
  }
  const time = parseTime(draft.recurrenceTime);
  if (!time) return null;
  if (draft.recurrencePreset === "hourly") return `${time.minute} * * * *`;
  if (draft.recurrencePreset === "daily") return `${time.minute} ${time.hour} * * *`;
  return `${time.minute} ${time.hour} * * ${draft.recurrenceWeekday}`;
}

export type DraftCheck =
  | { readonly kind: "ok"; readonly definition: JobDefinitionInput }
  | { readonly kind: "invalid"; readonly errors: Record<string, string> };

export function draftToDefinition(draft: JobDraft, now: Date): DraftCheck {
  const errors: Record<string, string> = {};

  const name = draft.name.trim();
  if (name.length === 0) errors.name = "A Job needs a name.";

  let work: JobWork | undefined;
  if (draft.kind === "agent") {
    if (draft.prompt.trim().length === 0) errors.prompt = "An Agent Job needs a prompt.";
    const model = draft.model.trim();
    work = { kind: "agent", prompt: draft.prompt, ...(model.length > 0 ? { model } : {}) };
  } else {
    if (draft.command.trim().length === 0) errors.command = "A Command Job needs a command.";
    work = { kind: "command", command: draft.command };
  }

  let trigger: JobTrigger | undefined;
  const timezone = draft.timezone.trim();
  if (draft.triggerKind === "manual") {
    trigger = { kind: "manual" };
  } else if (timezone.length === 0) {
    errors.timezone = "A scheduled Trigger needs an IANA timezone.";
  } else if (draft.triggerKind === "recurring") {
    const cron = cronFromDraft(draft);
    if (!cron) {
      errors.cron =
        draft.recurrencePreset === "custom"
          ? "The advanced schedule needs a cron expression."
          : "The recurrence time must look like 09:30.";
    } else {
      trigger = { kind: "recurring", cron, timezone };
    }
  } else {
    const instant = Date.parse(draft.runAt.trim());
    if (!Number.isFinite(instant)) {
      errors.runAt =
        "The one-shot time must be an ISO-8601 instant, e.g. 2026-09-01T09:00:00+02:00.";
    } else if (instant <= now.getTime()) {
      errors.runAt = "The one-shot time must be in the future.";
    } else {
      trigger = { kind: "oneShot", runAt: draft.runAt.trim(), timezone };
    }
  }

  const timeoutText = draft.timeoutMinutes.trim();
  const timeoutMinutes = timeoutText.length === 0 ? DEFAULT_TIMEOUT_MINUTES : Number(timeoutText);
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 1440) {
    errors.timeoutMinutes = "The timeout must be a whole number of minutes from 1 through 1440.";
  }

  let repository: { readonly url: string } | undefined;
  const repositoryUrl = draft.repositoryUrl.trim();
  if (repositoryUrl.length > 0) {
    try {
      const url = new URL(repositoryUrl);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        throw new Error("unsupported repository URL");
      }
      repository = { url: repositoryUrl };
    } catch {
      errors.repositoryUrl = "The repository needs an HTTP(S) URL without embedded credentials.";
    }
  }

  if (Object.keys(errors).length > 0 || !work || !trigger) {
    return { kind: "invalid", errors };
  }
  return {
    kind: "ok",
    definition: {
      name,
      work,
      trigger,
      ...(repository ? { repository } : {}),
      timeoutMinutes,
      secretRefs: draft.secretRefs,
    },
  };
}

export function toggleSecretRef(refs: readonly string[], name: string): readonly string[] {
  return refs.includes(name) ? refs.filter((ref) => ref !== name) : [...refs, name];
}

export function describeDefinitionTrigger(trigger: JobTrigger): string {
  if (trigger.kind === "manual") return "Manual only";
  if (trigger.kind === "oneShot") return `One-shot at ${trigger.runAt} (${trigger.timezone})`;
  return `Recurring ${trigger.cron} (${trigger.timezone})`;
}

/**
 * The review confirmation for Command Job authoring is required by the
 * remote-action safety policy when creating a Command Job or saving a
 * changed shell command. Editing only other fields of an existing Command
 * Job does not require the sheet.
 */
export function needsCommandReview(
  definition: JobDefinitionInput,
  original: AutomationJob | null,
): boolean {
  if (definition.work.kind !== "command") return false;
  if (!original || original.work.kind !== "command") return true;
  return original.work.command !== definition.work.command;
}

/**
 * The exact review-sheet content mandated by the safety policy: the exact
 * command, repository, schedule, timeout, and selected Secret Reference
 * names — never a Secret Reference value.
 */
export function commandReviewLines(definition: JobDefinitionInput): string[] {
  if (definition.work.kind !== "command") return [];
  return [
    `Command: ${definition.work.command}`,
    `Repository: ${definition.repository?.url ?? "None"}`,
    `Schedule: ${describeDefinitionTrigger(definition.trigger)}`,
    `Timeout: ${definition.timeoutMinutes} min`,
    `Secret References: ${definition.secretRefs.length > 0 ? definition.secretRefs.join(", ") : "None"}`,
  ];
}
