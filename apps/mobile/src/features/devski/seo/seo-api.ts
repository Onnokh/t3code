import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { useSavedRemoteConnection } from "../../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../../state/workspace";
import {
  applySeoResult,
  interpretSeoResponse,
  readEnvelope,
  readSites,
  type SeoEnvelope,
  type SeoHistoryData,
  type SeoLogData,
  type SeoOpportunitiesData,
  type SeoPageDetailData,
  type SeoPagesData,
  type SeoQueriesData,
  type SeoRead,
  type SeoRegistryData,
  type SeoResult,
  type SeoSite,
  type SeoStatusData,
} from "./seo-state";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Typed read-only client for the Gateway SEO contract. Every call uses the
 * paired Device Session bearer against the environment origin. There is no
 * write, sync, or mutation method — the contract has none — and no direct
 * Ranksta or Google call ever leaves the phone.
 */
export type SeoClient = {
  readonly sites: () => Promise<SeoResult<SeoSite[]>>;
  readonly status: (site: string) => Promise<SeoResult<SeoEnvelope<SeoStatusData>>>;
  readonly pages: (site: string, window?: number) => Promise<SeoResult<SeoEnvelope<SeoPagesData>>>;
  readonly page: (site: string, path: string) => Promise<SeoResult<SeoEnvelope<SeoPageDetailData>>>;
  readonly opportunities: (
    site: string,
    kind?: string,
  ) => Promise<SeoResult<SeoEnvelope<SeoOpportunitiesData>>>;
  readonly queries: (
    site: string,
    options?: { readonly includeBrand?: boolean; readonly limit?: number },
  ) => Promise<SeoResult<SeoEnvelope<SeoQueriesData>>>;
  readonly history: (
    site: string,
    limit?: number,
  ) => Promise<SeoResult<SeoEnvelope<SeoHistoryData>>>;
  readonly registry: (site: string) => Promise<SeoResult<SeoEnvelope<SeoRegistryData>>>;
  readonly log: (site: string, path?: string) => Promise<SeoResult<SeoEnvelope<SeoLogData>>>;
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

export function createSeoClient(baseUrl: string, bearerToken: string): SeoClient {
  const origin = baseUrl.replace(/\/$/, "");

  async function call<T>(
    path: string,
    readValue: (body: unknown) => T | null,
  ): Promise<SeoResult<T>> {
    try {
      const response = await fetch(`${origin}/api/devski/v1/seo${path}`, {
        headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      return interpretSeoResponse({ kind: "response", status: response.status, body }, readValue);
    } catch {
      return interpretSeoResponse({ kind: "network-error" }, readValue);
    }
  }

  const readTyped = <T>(body: unknown) => readEnvelope<T>(body);

  return {
    sites: () => call("/sites", readSites),
    status: (site) => call(`/sites/${encode(site)}/status`, readTyped<SeoStatusData>),
    pages: (site, window) =>
      call(
        `/sites/${encode(site)}/pages${window ? `?window=${window}` : ""}`,
        readTyped<SeoPagesData>,
      ),
    page: (site, path) =>
      call(`/sites/${encode(site)}/pages/${encode(path)}`, readTyped<SeoPageDetailData>),
    opportunities: (site, kind) =>
      call(
        `/sites/${encode(site)}/opportunities${kind ? `?kind=${encode(kind)}` : ""}`,
        readTyped<SeoOpportunitiesData>,
      ),
    queries: (site, options) => {
      const query = new URLSearchParams();
      if (options?.includeBrand) query.set("includeBrand", "true");
      if (options?.limit) query.set("limit", String(options.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return call(`/sites/${encode(site)}/queries${suffix}`, readTyped<SeoQueriesData>);
    },
    history: (site, limit) =>
      call(
        `/sites/${encode(site)}/history${limit ? `?limit=${limit}` : ""}`,
        readTyped<SeoHistoryData>,
      ),
    registry: (site) => call(`/sites/${encode(site)}/registry`, readTyped<SeoRegistryData>),
    log: (site, path) =>
      call(
        `/sites/${encode(site)}/log${path ? `?path=${encode(path)}` : ""}`,
        readTyped<SeoLogData>,
      ),
  };
}

/**
 * Resolves the SEO client for the paired environment, or null while this
 * device is unpaired. Uses the same Device Session bearer that Code and
 * Automations already hold.
 */
export function useSeoClient(): SeoClient | null {
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
    return createSeoClient(httpBaseUrl, bearerToken);
  }, [bearerToken, httpBaseUrl]);
}

/**
 * One screen's revalidating read: loads on focus, again when the app
 * returns to the foreground, and whenever the fetcher identity changes
 * (the selected Site is part of that identity). A failed revalidation
 * retains the last successful envelope so the screen shows visibly stale
 * data instead of losing it. Never triggers a backend sync.
 */
export function useSeoRead<T>(fetcher: (() => Promise<SeoResult<SeoEnvelope<T>>>) | null): {
  readonly read: SeoRead<T>;
  readonly reload: () => Promise<void>;
} {
  const [read, setRead] = useState<SeoRead<T>>({ kind: "loading" });
  const readRef = useRef(read);
  readRef.current = read;
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (!fetcher) return;
    const ticket = ++generation.current;
    const result = await fetcher();
    if (generation.current !== ticket) return;
    setRead(applySeoResult(readRef.current, result));
  }, [fetcher]);

  // A new fetcher identity (Site change, repair) starts from loading so
  // another Site's retained data can never masquerade as this Site's.
  useEffect(() => {
    generation.current += 1;
    setRead({ kind: "loading" });
  }, [fetcher]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => subscription.remove();
  }, [reload]);

  return { read, reload };
}
