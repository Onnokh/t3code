import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { useDevskiConnection } from "../devski-read-cache-store";
import { useDevskiCacheEntry, writeDevskiCacheEntry } from "../devski-read-cache";
import {
  applySeoResult,
  displayableEnvelope,
  interpretSeoResponse,
  readEnvelope,
  readSites,
  readSyncRequested,
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
  type SeoSyncRequested,
} from "./seo-state";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Typed client for the Gateway SEO contract. Every call uses the paired
 * Device Session bearer against the environment origin, and no direct Ranksta
 * or Google call ever leaves the phone.
 *
 * The reads are the whole surface bar one operation: `sync` asks Ranksta to
 * fetch this Site from Search Console. It changes nothing in Ranksta that the
 * app can write, and it is only ever called from pull to refresh.
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
  readonly sync: (site: string) => Promise<SeoResult<SeoSyncRequested>>;
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

export function createSeoClient(baseUrl: string, bearerToken: string): SeoClient {
  const origin = baseUrl.replace(/\/$/, "");

  async function call<T>(
    path: string,
    readValue: (body: unknown) => T | null,
    method: "GET" | "POST" = "GET",
  ): Promise<SeoResult<T>> {
    try {
      const response = await fetch(`${origin}/api/devski/v1/seo${path}`, {
        method,
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
    sync: (site) => call(`/sites/${encode(site)}/sync`, readSyncRequested, "POST"),
  };
}

/**
 * Resolves the SEO client for the paired environment, or null while this
 * device is unpaired. Uses the same Device Session bearer that Code and
 * Automations already hold, and the same Session the read cache is opened
 * for, so a re-issued credential cannot hydrate the previous session's reads.
 */
export function useSeoClient(): SeoClient | null {
  const connection = useDevskiConnection();
  return useMemo(
    () =>
      connection === null ? null : createSeoClient(connection.httpBaseUrl, connection.bearerToken),
    [connection],
  );
}

// Screens name their reads; the Area owns the namespace, so nothing else
// can be dropped or hydrated by a key an SEO screen happens to choose.
function seoCacheKey(key: string | null): string | null {
  return key === null ? null : `seo:${key}`;
}

/**
 * One screen's revalidating read: draws this key's last value at once, then
 * loads on focus, again when the app returns to the foreground, and whenever
 * the fetcher identity changes (the selected Site is part of that identity).
 * A cached value never stands in for the read — the read always runs — and a
 * failed revalidation retains the last successful envelope so the screen
 * shows visibly stale data instead of losing it. Never requests a sync.
 */
export function useSeoRead<T>(
  cacheKey: string | null,
  fetcher: (() => Promise<SeoResult<SeoEnvelope<T>>>) | null,
): {
  readonly read: SeoRead<T>;
  readonly reload: () => Promise<void>;
} {
  const cached = useDevskiCacheEntry<SeoEnvelope<T>>(seoCacheKey(cacheKey));
  // A new key (Site change, re-pair) falls back to that key's own last
  // value, so another Site's data can never masquerade as this Site's.
  const [live, setLive] = useState<SeoRead<T> | null>(null);
  const read = useMemo<SeoRead<T>>(() => {
    if (live !== null) return live;
    if (cached === null) return { kind: "loading" };
    // A value this device stored at an earlier launch is drawn, and said to
    // be unconfirmed until the read that follows it lands.
    return { kind: "ready", envelope: cached.value, unconfirmed: cached.persisted };
  }, [live, cached]);
  const readRef = useRef(read);
  readRef.current = read;
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (!fetcher) return;
    const ticket = ++generation.current;
    const result = await fetcher();
    if (generation.current !== ticket) return;
    if (result.kind === "ok") writeDevskiCacheEntry(seoCacheKey(cacheKey), result.value);
    setLive(applySeoResult(readRef.current, result));
  }, [cacheKey, fetcher]);

  useEffect(() => {
    generation.current += 1;
    setLive(null);
  }, [cacheKey]);

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

/**
 * One screen's pull to refresh: read live now, and ask Ranksta to look at
 * Search Console again.
 *
 * The gesture resolves on the read. A Search Console sync takes minutes and
 * outlives the gesture, so a spinner tied to it would look broken, and a
 * sync request that fails never fails the refresh — the read is what the
 * owner sees, the sync is a request about the future. Nothing is said about
 * what became of that request: both states the Gateway accepts mean the same
 * thing, and a refused one leaves the live read on screen untouched, so a
 * sentence about it would explain a screen that is already correct.
 *
 * What the gesture does show for itself is `syncedAt` — when this Site's
 * Search Console data last arrived. It comes from the `status` read because
 * that is the only read the Gateway populates it on, which makes it a second
 * request per screen. That is the deliberate cost: the alternative is a synced
 * time on the home screen alone, and a refresh happens on all seven.
 */
export function useSeoRefresh(
  client: SeoClient | null,
  site: string | null,
  read: () => Promise<unknown>,
): {
  readonly refreshing: boolean;
  readonly refresh: () => void;
  readonly syncedAt: string | null;
} {
  const statusFetcher = useMemo(
    () => (client && site ? () => client.status(site) : null),
    [client, site],
  );
  // The same hook and key discipline every screen's own read uses, so the
  // synced time is drawn from this device at launch, replaced by the read that
  // follows it, retained when a read fails, and never shown for another Site.
  const status = useSeoRead(site ? `status:${site}` : null, statusFetcher);
  const [refreshing, setRefreshing] = useState(false);
  const readRef = useRef(read);
  readRef.current = read;
  const generation = useRef(0);

  // A gesture belongs to the Site it was made on. Switching Site abandons it,
  // so the spinner stops rather than waiting on an answer this screen no
  // longer accepts.
  useEffect(() => {
    generation.current += 1;
    setRefreshing(false);
  }, [site]);

  const refresh = useCallback(() => {
    const ticket = ++generation.current;
    setRefreshing(true);
    // The synced time is read alongside the screen's data rather than after
    // it, so the one visible outcome of the gesture lands with everything else.
    void Promise.all([readRef.current(), status.reload()])
      .catch(() => undefined)
      .finally(() => {
        if (generation.current === ticket) setRefreshing(false);
      });
    if (!client || site === null) return;
    // Deliberately unawaited and unreported: the sync is a request about the
    // future, and the client answers rather than rejects, so this catch only
    // guards the refresh against a defect breaking the read.
    void client.sync(site).catch(() => undefined);
  }, [client, site, status.reload]);

  return {
    refreshing,
    refresh,
    // Whatever the status read can show, what it retained through a failure
    // included: the last synced time this device knows of is still a fact
    // about the data, where a null would claim nothing ever synced.
    syncedAt: displayableEnvelope(status.read)?.freshness.syncedAt ?? null,
  };
}
