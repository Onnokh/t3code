import { useMemo } from "react";

import { useSavedRemoteConnection } from "../../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../../state/workspace";
import {
  interpretAutomationsResponse,
  readArtifacts,
  readJob,
  readJobs,
  readLog,
  readRun,
  readRuns,
  readTriggerResult,
  type ArtifactSummary,
  type AutomationJob,
  type AutomationRun,
  type AutomationsResult,
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

/**
 * Resolves the Automations client for the paired environment, or null while
 * this device is unpaired. Uses the same Device Session bearer that Code and
 * the capabilities probe already hold.
 */
export function useAutomationsClient(): AutomationsClient | null {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const bearerToken = connection?.bearerToken;
  const httpBaseUrl = connection?.httpBaseUrl;

  return useMemo(() => {
    if (!bearerToken || !httpBaseUrl) return null;
    return createAutomationsClient(httpBaseUrl, bearerToken);
  }, [bearerToken, httpBaseUrl]);
}
