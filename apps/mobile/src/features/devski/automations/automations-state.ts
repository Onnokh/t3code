/**
 * Pure interpretation of the Devski Automations contract
 * (`/api/devski/v1/automations/*`). The Gateway translates the private
 * Harness control service into typed responses; this module classifies
 * them for the plain Automations screens and never invents server state.
 */

export type RunState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "legacy";

export type JobWork =
  | { readonly kind: "agent"; readonly prompt: string; readonly model?: string }
  | { readonly kind: "command"; readonly command: string };

export type JobTrigger =
  | { readonly kind: "manual" }
  | { readonly kind: "oneShot"; readonly runAt: string; readonly timezone: string }
  | { readonly kind: "recurring"; readonly cron: string; readonly timezone: string };

export type RunSummary = {
  readonly id: string;
  readonly state: RunState;
  readonly requestedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
};

export type AutomationJob = {
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly work: JobWork;
  readonly trigger: JobTrigger;
  readonly repository?: { readonly url: string };
  readonly timeoutMinutes: number;
  readonly enabled: boolean;
  readonly secretRefs: readonly string[];
  readonly archivedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nextRunAt?: string;
  readonly activeRunId?: string;
  readonly latestRun?: RunSummary;
};

export type AutomationRun = {
  readonly id: string;
  readonly jobId?: string;
  readonly job: string;
  readonly cause: "scheduled" | "manual";
  readonly state: RunState;
  readonly requestedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly errorSummary?: string;
  readonly log?: {
    readonly available: boolean;
    readonly byteLength: number;
    readonly truncated: boolean;
  };
  readonly artifacts?: readonly ArtifactSummary[];
};

export type ArtifactSummary = {
  readonly id: string;
  readonly runId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly createdAt: string;
  readonly previewable: boolean;
};

export type RunLogRead = {
  readonly text: string;
  readonly nextCursor: string;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly retainedBytes: number;
};

/** Param list for the plain Automations navigation stack. */
export type AutomationsStackParamList = {
  readonly AutomationsHome: undefined;
  readonly AutomationJob: { readonly jobId: string; readonly name?: string };
  readonly AutomationRun: { readonly runId: string };
};

export type ContractError = {
  readonly code: string;
  readonly message: string;
  readonly requestId?: string;
  /** Present on `job_running`: the active Run the server pointed at. */
  readonly run?: AutomationRun;
};

export type AutomationsResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "pairing-required" }
  | { readonly kind: "error"; readonly error: ContractError };

/**
 * Classifies one Gateway Automations response. The server is authoritative:
 * a 401 means the Device Session is gone, an error body is surfaced as-is,
 * and anything unreadable is reported as an unavailable service.
 */
export function interpretAutomationsResponse<T>(
  response:
    | { readonly kind: "response"; readonly status: number; readonly body: unknown }
    | { readonly kind: "network-error" },
  readValue: (body: unknown) => T | null,
): AutomationsResult<T> {
  if (response.kind === "network-error") {
    return {
      kind: "error",
      error: {
        code: "automations_unavailable",
        message: "The Automations service is unreachable.",
      },
    };
  }
  if (response.status === 401) return { kind: "pairing-required" };
  const body = response.body as { code?: unknown; message?: unknown; requestId?: unknown } | null;
  if (response.status >= 200 && response.status < 300) {
    const value = readValue(response.body);
    if (value !== null) return { kind: "ok", value };
    return {
      kind: "error",
      error: {
        code: "automations_unavailable",
        message: "The Automations service answered unexpectedly.",
      },
    };
  }
  if (body && typeof body === "object" && typeof body.code === "string") {
    const run = (body as { run?: unknown }).run;
    return {
      kind: "error",
      error: {
        code: body.code,
        message: typeof body.message === "string" ? body.message : "The request failed.",
        ...(typeof body.requestId === "string" ? { requestId: body.requestId } : {}),
        ...(run && typeof run === "object" ? { run: run as AutomationRun } : {}),
      },
    };
  }
  return {
    kind: "error",
    error: {
      code: "automations_unavailable",
      message: `The request failed (HTTP ${response.status}).`,
    },
  };
}

export function readJobs(body: unknown): AutomationJob[] | null {
  const jobs = (body as { jobs?: unknown } | null)?.jobs;
  return Array.isArray(jobs) ? (jobs as AutomationJob[]) : null;
}

export function readJob(body: unknown): AutomationJob | null {
  const job = (body as { job?: unknown } | null)?.job;
  return job && typeof job === "object" ? (job as AutomationJob) : null;
}

export function readRuns(body: unknown): AutomationRun[] | null {
  const runs = (body as { runs?: unknown } | null)?.runs;
  return Array.isArray(runs) ? (runs as AutomationRun[]) : null;
}

export function readRun(body: unknown): AutomationRun | null {
  const run = (body as { run?: unknown } | null)?.run;
  return run && typeof run === "object" ? (run as AutomationRun) : null;
}

export function readTriggerResult(body: unknown): { kind: string; run: AutomationRun } | null {
  const candidate = body as { kind?: unknown; run?: unknown } | null;
  if (!candidate || typeof candidate.kind !== "string") return null;
  if (!candidate.run || typeof candidate.run !== "object") return null;
  return { kind: candidate.kind, run: candidate.run as AutomationRun };
}

export function readLog(body: unknown): RunLogRead | null {
  const log = (body as { log?: unknown } | null)?.log;
  if (!log || typeof log !== "object") return null;
  const candidate = log as { text?: unknown; nextCursor?: unknown; complete?: unknown };
  if (typeof candidate.text !== "string" || typeof candidate.nextCursor !== "string") return null;
  return log as RunLogRead;
}

export function readArtifacts(body: unknown): ArtifactSummary[] | null {
  const artifacts = (body as { artifacts?: unknown } | null)?.artifacts;
  return Array.isArray(artifacts) ? (artifacts as ArtifactSummary[]) : null;
}

export function summarizeError(result: AutomationsResult<unknown>): string {
  if (result.kind === "pairing-required") {
    return "This Device Session expired or was revoked. Pair this device again.";
  }
  if (result.kind === "error") return result.error.message;
  return "The request failed.";
}

export function isRunActive(state: RunState): boolean {
  return state === "pending" || state === "running";
}

export function splitJobs(jobs: readonly AutomationJob[]): {
  readonly active: AutomationJob[];
  readonly archived: AutomationJob[];
} {
  return {
    active: jobs.filter((job) => !job.archivedAt),
    archived: jobs.filter((job) => Boolean(job.archivedAt)),
  };
}

export function describeTrigger(trigger: JobTrigger): string {
  if (trigger.kind === "manual") return "Manual only";
  if (trigger.kind === "oneShot") {
    return `One-shot at ${new Date(trigger.runAt).toLocaleString()} (${trigger.timezone})`;
  }
  return `Recurring ${trigger.cron} (${trigger.timezone})`;
}

export function describeWork(work: JobWork): string {
  return work.kind === "agent" ? "Agent Job (OpenCode prompt)" : "Command Job";
}

export function describeRunState(state: RunState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    case "legacy":
      return "Legacy (no recorded outcome)";
  }
}

export function describeRunSummary(run: RunSummary | undefined): string {
  if (!run) return "Never ran";
  const when = run.finishedAt ?? run.startedAt ?? run.requestedAt;
  return `${describeRunState(run.state)} · ${new Date(when).toLocaleString()}`;
}

export function describeJobSchedule(job: AutomationJob): string {
  if (job.archivedAt) return `Archived ${new Date(job.archivedAt).toLocaleString()}`;
  if (!job.enabled && job.trigger.kind !== "manual") return "Disabled";
  if (job.trigger.kind === "manual") return "Manual only";
  if (job.nextRunAt) return `Next Run ${new Date(job.nextRunAt).toLocaleString()}`;
  return "No next Run";
}

export function formatByteLength(byteLength: number): string {
  if (byteLength < 1_024) return `${byteLength} B`;
  if (byteLength < 1_024 * 1_024) return `${(byteLength / 1_024).toFixed(1)} kB`;
  return `${(byteLength / (1_024 * 1_024)).toFixed(1)} MB`;
}
