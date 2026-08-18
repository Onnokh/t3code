import { useMemo } from "react";

import { useDevskiConnection } from "../devski-read-cache-store";
import { dropDevskiCacheEntries } from "../devski-read-cache";
import type { JobDefinitionInput } from "./automations-authoring";
import {
  interpretAutomationsResponse,
  readArtifacts,
  readJob,
  readJobMutation,
  readJobs,
  readLog,
  readModels,
  readRun,
  readRuns,
  readSecretReferenceNames,
  readTriggerResult,
  type ArtifactSummary,
  type AutomationJob,
  type AutomationRun,
  type AutomationsResult,
  type ModelCatalog,
  type RunLogRead,
} from "./automations-state";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Typed client for the Gateway Automations contract. Every call uses the
 * paired Device Session bearer against the environment origin; the client
 * can only name opaque Job, Run, and Artifact IDs. There is no offline
 * queue: the server stays authoritative and failures surface immediately.
 */
export type AutomationsClient = {
  readonly listJobs: () => Promise<AutomationsResult<AutomationJob[]>>;
  readonly getJob: (jobId: string) => Promise<AutomationsResult<AutomationJob>>;
  /** Live normalized OpenCode model choices for Agent Job authoring. */
  readonly listModels: () => Promise<AutomationsResult<ModelCatalog>>;
  /** Configured Secret Reference names; values never enter this contract. */
  readonly listSecretReferences: () => Promise<AutomationsResult<string[]>>;
  /**
   * `confirmCommand` is the authority-bearing review confirmation: for a
   * new or changed shell command it must repeat the exact command text the
   * review sheet displayed, or the server rejects the save.
   */
  readonly createJob: (
    definition: JobDefinitionInput,
    idempotencyKey: string,
    confirmCommand?: string,
  ) => Promise<AutomationsResult<AutomationJob>>;
  readonly updateJob: (
    jobId: string,
    revision: number,
    definition: JobDefinitionInput,
    confirmCommand?: string,
  ) => Promise<AutomationsResult<AutomationJob>>;
  /**
   * Lifecycle operations (PLO-419) at the observed Job Revision. A stale
   * revision fails with `revision_conflict` and the current Job; the
   * screen reloads authoritatively instead of overwriting.
   */
  readonly enableJob: (
    jobId: string,
    revision: number,
  ) => Promise<AutomationsResult<AutomationJob>>;
  readonly disableJob: (
    jobId: string,
    revision: number,
  ) => Promise<AutomationsResult<AutomationJob>>;
  readonly archiveJob: (
    jobId: string,
    revision: number,
  ) => Promise<AutomationsResult<AutomationJob>>;
  readonly restoreJob: (
    jobId: string,
    revision: number,
  ) => Promise<AutomationsResult<AutomationJob>>;
  /** Duplication answers a new disabled Job with no Runs or Workspace. */
  readonly duplicateJob: (
    jobId: string,
    name: string,
    idempotencyKey: string,
  ) => Promise<AutomationsResult<AutomationJob>>;
  /**
   * Permanent deletion. `confirmName` is the authority-bearing typed-name
   * confirmation: the server compares it against the exact current Job
   * name and also requires the latest revision and no active Run.
   */
  readonly deleteJob: (
    jobId: string,
    revision: number,
    confirmName: string,
  ) => Promise<AutomationsResult<AutomationJob>>;
  readonly listRuns: (jobId: string, limit?: number) => Promise<AutomationsResult<AutomationRun[]>>;
  readonly runNow: (
    jobId: string,
    idempotencyKey: string,
    confirmDisabled?: boolean,
  ) => Promise<AutomationsResult<{ kind: string; run: AutomationRun }>>;
  readonly getRun: (runId: string) => Promise<AutomationsResult<AutomationRun>>;
  readonly cancelRun: (
    runId: string,
    idempotencyKey: string,
  ) => Promise<AutomationsResult<{ kind: string; run: AutomationRun }>>;
  readonly readRunLog: (
    runId: string,
    options?: { readonly cursor?: string; readonly limit?: number },
  ) => Promise<AutomationsResult<RunLogRead>>;
  readonly listArtifacts: (runId: string) => Promise<AutomationsResult<ArtifactSummary[]>>;
  readonly fetchArtifact: (
    runId: string,
    artifactId: string,
  ) => Promise<
    | { readonly kind: "ok"; readonly bytes: Uint8Array }
    | { readonly kind: "error"; readonly message: string }
  >;
};

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export function createAutomationsClient(baseUrl: string, bearerToken: string): AutomationsClient {
  const origin = baseUrl.replace(/\/$/, "");

  async function call<T>(
    path: string,
    readValue: (body: unknown) => T | null,
    init?: RequestInit,
  ): Promise<AutomationsResult<T>> {
    try {
      const response = await fetch(`${origin}/api/devski/v1/automations${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${bearerToken}`,
          accept: "application/json",
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      return interpretAutomationsResponse(
        { kind: "response", status: response.status, body },
        readValue,
      );
    } catch {
      return interpretAutomationsResponse({ kind: "network-error" }, readValue);
    }
  }

  return {
    listJobs: () => call("/jobs", readJobs),
    getJob: (jobId) => call(`/jobs/${encodeId(jobId)}`, readJob),
    listModels: () => call("/models", readModels),
    listSecretReferences: () => call("/secret-references", readSecretReferenceNames),
    createJob: (definition, idempotencyKey, confirmCommand) =>
      call("/jobs", readJobMutation, {
        method: "POST",
        body: JSON.stringify({
          definition,
          idempotencyKey,
          ...(confirmCommand !== undefined ? { confirmCommand } : {}),
        }),
      }),
    updateJob: (jobId, revision, definition, confirmCommand) =>
      call(`/jobs/${encodeId(jobId)}`, readJobMutation, {
        method: "PUT",
        body: JSON.stringify({
          revision,
          definition,
          ...(confirmCommand !== undefined ? { confirmCommand } : {}),
        }),
      }),
    enableJob: (jobId, revision) =>
      call(`/jobs/${encodeId(jobId)}/enable`, readJobMutation, {
        method: "POST",
        body: JSON.stringify({ revision }),
      }),
    disableJob: (jobId, revision) =>
      call(`/jobs/${encodeId(jobId)}/disable`, readJobMutation, {
        method: "POST",
        body: JSON.stringify({ revision }),
      }),
    archiveJob: (jobId, revision) =>
      call(`/jobs/${encodeId(jobId)}/archive`, readJobMutation, {
        method: "POST",
        body: JSON.stringify({ revision }),
      }),
    restoreJob: (jobId, revision) =>
      call(`/jobs/${encodeId(jobId)}/restore`, readJobMutation, {
        method: "POST",
        body: JSON.stringify({ revision }),
      }),
    duplicateJob: (jobId, name, idempotencyKey) =>
      call(`/jobs/${encodeId(jobId)}/duplicate`, readJobMutation, {
        method: "POST",
        body: JSON.stringify({ name, idempotencyKey }),
      }),
    deleteJob: (jobId, revision, confirmName) =>
      call(`/jobs/${encodeId(jobId)}`, readJobMutation, {
        method: "DELETE",
        body: JSON.stringify({ revision, confirmName }),
      }),
    listRuns: (jobId, limit = 100) =>
      call(`/jobs/${encodeId(jobId)}/runs?limit=${limit}`, readRuns),
    runNow: (jobId, idempotencyKey, confirmDisabled) =>
      call(`/jobs/${encodeId(jobId)}/runs`, readTriggerResult, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey,
          ...(confirmDisabled ? { confirmDisabled: true } : {}),
        }),
      }),
    getRun: (runId) => call(`/runs/${encodeId(runId)}`, readRun),
    cancelRun: (runId, idempotencyKey) =>
      call(`/runs/${encodeId(runId)}/cancel`, readTriggerResult, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      }),
    readRunLog: (runId, options) => {
      const query = new URLSearchParams();
      if (options?.cursor) query.set("cursor", options.cursor);
      if (options?.limit) query.set("limit", String(options.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return call(`/runs/${encodeId(runId)}/log${suffix}`, readLog);
    },
    listArtifacts: (runId) => call(`/runs/${encodeId(runId)}/artifacts`, readArtifacts),
    fetchArtifact: async (runId, artifactId) => {
      try {
        const response = await fetch(
          `${origin}/api/devski/v1/automations/runs/${encodeId(runId)}/artifacts/${encodeId(artifactId)}`,
          {
            headers: { authorization: `Bearer ${bearerToken}` },
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (!response.ok)
          return { kind: "error", message: `Download failed (HTTP ${response.status}).` };
        return { kind: "ok", bytes: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        return {
          kind: "error",
          message: "Download failed: the Automations service is unreachable.",
        };
      }
    },
  };
}

const AUTOMATIONS_CACHE_NAMESPACE = "automations:";

/** Cache keys for the reads Automations screens hydrate from. */
export const automationsCacheKeys = {
  jobs: `${AUTOMATIONS_CACHE_NAMESPACE}jobs`,
  job: (jobId: string) => `${AUTOMATIONS_CACHE_NAMESPACE}job:${jobId}`,
  run: (runId: string) => `${AUTOMATIONS_CACHE_NAMESPACE}run:${runId}`,
} as const;

/**
 * Wraps every mutating method so a successful one drops the Area's cached
 * reads.
 *
 * Jobs and Runs change under the user's own hand, unlike SEO's read-only
 * data. Hydrating a Job list that predates the Job just created — or a Run
 * that predates the Stop just confirmed — would show the user their own
 * action being undone, so a mutation invalidates rather than repairs: the
 * revalidation that always follows supplies the authoritative state.
 * Sitting at the client boundary makes this impossible to forget when a
 * new mutation is added to a screen.
 */
function invalidatingOnMutation(client: AutomationsClient): AutomationsClient {
  function afterMutation<Args extends unknown[], T>(
    method: (...args: Args) => Promise<AutomationsResult<T>>,
  ): (...args: Args) => Promise<AutomationsResult<T>> {
    return async (...args: Args) => {
      const result = await method(...args);
      if (result.kind === "ok") dropDevskiCacheEntries(AUTOMATIONS_CACHE_NAMESPACE);
      return result;
    };
  }

  return {
    ...client,
    createJob: afterMutation(client.createJob),
    updateJob: afterMutation(client.updateJob),
    enableJob: afterMutation(client.enableJob),
    disableJob: afterMutation(client.disableJob),
    archiveJob: afterMutation(client.archiveJob),
    restoreJob: afterMutation(client.restoreJob),
    duplicateJob: afterMutation(client.duplicateJob),
    deleteJob: afterMutation(client.deleteJob),
    runNow: afterMutation(client.runNow),
    cancelRun: afterMutation(client.cancelRun),
  };
}

/**
 * Resolves the Automations client for the paired environment, or null while
 * this device is unpaired. Uses the same Device Session bearer that Code and
 * the capabilities probe already hold, and the same Session the read cache is
 * opened for, so a re-issued credential cannot hydrate the previous session's
 * reads.
 */
export function useAutomationsClient(): AutomationsClient | null {
  const connection = useDevskiConnection();
  return useMemo(
    () =>
      connection === null
        ? null
        : invalidatingOnMutation(
            createAutomationsClient(connection.httpBaseUrl, connection.bearerToken),
          ),
    [connection],
  );
}
