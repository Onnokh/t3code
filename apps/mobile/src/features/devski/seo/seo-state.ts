/**
 * Pure interpretation of the Devski SEO Contract (`/api/devski/v1/seo/*`).
 * The Gateway proxies Ranksta's Paradise and wraps every site-scoped read in
 * a `SeoEnvelope`; this module classifies those responses for the plain SEO
 * screens. It preserves Ranksta's semantics — verdicts, reasons, trueTotals,
 * phases, and index state are displayed as returned and never recomputed on
 * the phone. Unknown future enum values stay display-safe strings.
 *
 * The contract has one operation, the Site sync, and this module classifies
 * its answer too. Every accepted sync request is a success, a cooldown
 * included; see `describeSyncRequest`.
 */

export type SeoSite = {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly available: boolean;
};

export type SeoFreshness = {
  readonly syncedAt: string | null;
  readonly rangeStart: string | null;
  readonly rangeEnd: string | null;
  readonly stale: boolean;
};

export type SeoEnvelope<T> = {
  readonly site: { readonly id: string; readonly label: string; readonly url: string };
  readonly data: T;
  readonly freshness: SeoFreshness;
  readonly requestId: string;
};

/** The four Search Console metrics as tidied by Ranksta for display. */
export type SeoMetrics = {
  readonly impressions: number;
  readonly clicks: number;
  readonly ctr: number;
  readonly position: number;
};

/** A current-vs-previous window with Ranksta's own deltas. */
export type SeoWindow = {
  readonly current: SeoMetrics;
  readonly previous: SeoMetrics;
  readonly deltaImpressions: number;
  readonly deltaClicks: number;
};

export type SeoStatusData = {
  readonly data: {
    readonly firstDate: string | null;
    readonly lastDate: string | null;
    readonly syncedDays: number;
    readonly snapshotRows: number;
    readonly dailyTotalsDays: number;
    readonly note: string;
  };
  readonly registry: {
    readonly targets: number;
    readonly keywords: number;
    readonly clusters: number;
  };
  readonly sitemap: { readonly pages: number; readonly unmapped: readonly string[] };
  readonly actions: number;
};

export type SeoPageRow = {
  readonly path: string;
  readonly mapped: boolean;
  readonly phase: string;
  readonly priority: string | null;
  readonly intent: string | null;
  readonly clusters: readonly string[];
  readonly keywords: readonly string[];
  readonly publishedAt: string | null;
  readonly status: string | null;
  readonly indexed: string;
  readonly whyOpportunity: string | null;
  readonly nonBrand: SeoWindow | null;
  readonly allQueries: SeoWindow | null;
  readonly trueTotals: SeoWindow | null;
  readonly baseline: SeoMetrics | null;
  readonly signals: readonly string[];
  readonly verdict: string;
  readonly reasons: readonly string[];
};

export type SeoPagesData = {
  readonly window: {
    readonly days: number;
    readonly currentStart: string | null;
    readonly currentEnd: string | null;
    readonly previousStart: string | null;
    readonly previousEnd: string | null;
  };
  readonly note: string;
  readonly pages: readonly SeoPageRow[];
};

export type SeoSignal = {
  readonly kind: string;
  readonly query: string | null;
  readonly page: string;
  readonly pages: readonly string[];
  readonly mapped: boolean;
  readonly current: SeoMetrics;
  readonly previous: SeoMetrics | null;
  readonly recommendation: string;
  readonly score: number;
  readonly registry?: {
    readonly targetUrl: string;
    readonly priority: string;
    readonly intent: string;
    readonly cluster: string;
  } | null;
};

export type SeoOpportunitiesData = {
  readonly window: {
    readonly currentStart: string | null;
    readonly currentEnd: string | null;
    readonly previousStart: string | null;
    readonly previousEnd: string | null;
  };
  readonly signals: readonly SeoSignal[];
};

export type SeoQueryRow = {
  readonly query: string;
  readonly page: string;
  readonly brand: boolean;
  readonly mappedTarget: string | null;
  readonly current: SeoMetrics;
  readonly previous: SeoMetrics | null;
};

export type SeoQueriesData = {
  readonly window: {
    readonly currentStart: string | null;
    readonly currentEnd: string | null;
    readonly previousStart: string | null;
    readonly previousEnd: string | null;
  };
  readonly queries: readonly SeoQueryRow[];
};

export type SeoHistoryDay = {
  readonly date: string;
  readonly provisional: boolean;
  readonly impressions: number;
  readonly clicks: number;
  readonly ctr: number;
  readonly position: number;
};

export type SeoHistoryData = { readonly days: readonly SeoHistoryDay[] };

export type SeoRegistryTarget = {
  readonly targetUrl: string;
  readonly phase: string;
  readonly state: string;
  readonly indexed: string;
  readonly coverageState: string | null;
  readonly inspectedAt: string | null;
  readonly priority: string | null;
  readonly intent: string;
  readonly publishedAt: string | null;
  readonly baselineDate: string | null;
  readonly status: string;
  readonly whyOpportunity: string | null;
  readonly measuredFrom: string | null;
  readonly window: SeoMetrics;
  readonly baseline: SeoMetrics | null;
  readonly keywords: ReadonlyArray<{
    readonly keyword: string;
    readonly cluster: string;
    readonly intent: string;
    readonly country: string;
  }>;
};

export type SeoRegistryData = { readonly targets: readonly SeoRegistryTarget[] };

export type SeoLogEntry = {
  readonly id?: number;
  readonly date: string;
  readonly path: string;
  readonly kind: string;
  readonly note?: string | null;
};

export type SeoLogData = { readonly actions: readonly SeoLogEntry[] };

export type SeoPageDetailData = {
  readonly path: string;
  readonly mapped: boolean;
  readonly phase: string;
  readonly state: string | null;
  readonly indexed: string;
  readonly coverageState: string | null;
  readonly inspectedAt: string | null;
  readonly measuredFrom: string | null;
  readonly plan: ReadonlyArray<{
    readonly keyword: string;
    readonly cluster: string;
    readonly intent: string;
    readonly country: string;
    readonly priority: string;
    readonly publishedAt: string | null;
    readonly baselineDate: string | null;
    readonly status: string;
    readonly whyOpportunity: string;
  }>;
  readonly verdict: string;
  readonly reasons: readonly string[];
  readonly performance: {
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly scope: string;
    readonly total: SeoMetrics;
    readonly last7: SeoMetrics;
    readonly previous7: SeoMetrics;
    readonly days: ReadonlyArray<SeoMetrics & { readonly date: string }>;
  };
  readonly trueTotals: SeoWindow | null;
  readonly baseline: SeoMetrics | null;
  readonly topQueries: ReadonlyArray<{
    readonly query: string;
    readonly brand: boolean;
    readonly mapped: boolean;
    readonly current: SeoMetrics;
    readonly previous: SeoMetrics | null;
  }>;
  readonly signals: readonly SeoSignal[];
  readonly actions: readonly SeoLogEntry[];
};

/** Param list for the plain SEO navigation stack. */
export type SeoStackParamList = {
  readonly SeoHome: undefined;
  readonly SeoOpportunities: undefined;
  readonly SeoHistory: undefined;
  readonly SeoRegistry: undefined;
  readonly SeoLog: undefined;
  readonly SeoQueries: undefined;
  readonly SeoPage: { readonly path: string };
};

export type SeoError = {
  readonly code: string;
  readonly message: string;
  readonly requestId?: string;
};

export type SeoResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "pairing-required" }
  | { readonly kind: "error"; readonly error: SeoError };

/**
 * Classifies one Gateway SEO response. The server is authoritative: a 401
 * means the Device Session is gone, a typed error body surfaces as-is, and
 * anything unreadable reports the service unavailable.
 */
export function interpretSeoResponse<T>(
  response:
    | { readonly kind: "response"; readonly status: number; readonly body: unknown }
    | { readonly kind: "network-error" },
  readValue: (body: unknown) => T | null,
): SeoResult<T> {
  if (response.kind === "network-error") {
    return {
      kind: "error",
      error: { code: "unavailable", message: "The SEO service is unreachable." },
    };
  }
  if (response.status === 401) return { kind: "pairing-required" };
  if (response.status >= 200 && response.status < 300) {
    const value = readValue(response.body);
    if (value !== null) return { kind: "ok", value };
    return {
      kind: "error",
      error: { code: "unavailable", message: "The SEO service answered unexpectedly." },
    };
  }
  const body = response.body as { code?: unknown; message?: unknown; requestId?: unknown } | null;
  if (body && typeof body === "object" && typeof body.code === "string") {
    return {
      kind: "error",
      error: {
        code: body.code,
        message: typeof body.message === "string" ? body.message : "The request failed.",
        ...(typeof body.requestId === "string" ? { requestId: body.requestId } : {}),
      },
    };
  }
  return {
    kind: "error",
    error: { code: "unavailable", message: `The request failed (HTTP ${response.status}).` },
  };
}

export function readSites(body: unknown): SeoSite[] | null {
  const sites = (body as { sites?: unknown } | null)?.sites;
  if (!Array.isArray(sites)) return null;
  const valid = sites.every(
    (site) =>
      site &&
      typeof site === "object" &&
      typeof (site as { id?: unknown }).id === "string" &&
      typeof (site as { label?: unknown }).label === "string",
  );
  return valid ? (sites as SeoSite[]) : null;
}

/** Reads one `SeoEnvelope`; the site, data, and freshness are mandatory. */
export function readEnvelope<T>(body: unknown): SeoEnvelope<T> | null {
  const candidate = body as {
    site?: { id?: unknown };
    data?: unknown;
    freshness?: { stale?: unknown };
  } | null;
  if (!candidate || typeof candidate !== "object") return null;
  if (!candidate.site || typeof candidate.site.id !== "string") return null;
  if (candidate.data === undefined || candidate.data === null) return null;
  if (!candidate.freshness || typeof candidate.freshness.stale !== "boolean") return null;
  return candidate as SeoEnvelope<T>;
}

/**
 * What became of a sync request. `started` and `already-running` both mean
 * Ranksta is going to look at Search Console; `cooling-down` means the
 * Gateway's five-minute floor for this Site refused to spend the quota
 * again yet. The Gateway answers all three with 202, so none of them is an
 * error.
 */
export type SeoSyncState = "started" | "already-running" | "cooling-down";

export type SeoSyncRequested = {
  readonly site: { readonly id: string; readonly label: string; readonly url: string };
  readonly sync: {
    readonly state: SeoSyncState;
    readonly requestedAt: string;
    /** A number only for `cooling-down`. */
    readonly retryAfterSeconds: number | null;
  };
  readonly requestId: string;
};

/** Reads one accepted sync request; the Site and the sync state are mandatory. */
export function readSyncRequested(body: unknown): SeoSyncRequested | null {
  const candidate = body as {
    site?: { id?: unknown };
    sync?: { state?: unknown; requestedAt?: unknown; retryAfterSeconds?: unknown };
  } | null;
  if (!candidate || typeof candidate !== "object") return null;
  if (!candidate.site || typeof candidate.site.id !== "string") return null;
  const sync = candidate.sync;
  if (!sync || typeof sync !== "object") return null;
  if (
    sync.state !== "started" &&
    sync.state !== "already-running" &&
    sync.state !== "cooling-down"
  ) {
    return null;
  }
  if (typeof sync.requestedAt !== "string") return null;
  return candidate as SeoSyncRequested;
}

/**
 * Resolves the effective Site: the persisted choice when it is still
 * configured, otherwise the first available Site, otherwise the first
 * configured Site. The server never silently assumes a Site — this rule is
 * the client's visible first-install default.
 */
export function resolveSelectedSite(
  persistedId: string | undefined,
  sites: readonly SeoSite[],
): SeoSite | null {
  if (sites.length === 0) return null;
  const persisted = persistedId ? sites.find((site) => site.id === persistedId) : undefined;
  if (persisted) return persisted;
  return sites.find((site) => site.available) ?? sites[0] ?? null;
}

/**
 * One screen's read lifecycle. `ready` keeps the latest envelope; a failed
 * revalidation retains the last successful envelope so the screen can show
 * visibly stale data instead of losing it. `unconfirmed` marks an envelope
 * this device stored at an earlier launch and no read has confirmed yet.
 */
export type SeoRead<T> =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly envelope: SeoEnvelope<T>;
      readonly unconfirmed?: boolean;
    }
  | {
      readonly kind: "unavailable";
      readonly message: string;
      readonly retained: SeoEnvelope<T> | null;
    }
  | { readonly kind: "pairing-required" };

/**
 * Folds one read result into the previous screen state, retaining the last
 * successful envelope across failures.
 */
export function applySeoResult<T>(
  previous: SeoRead<T>,
  result: SeoResult<SeoEnvelope<T>>,
): SeoRead<T> {
  if (result.kind === "ok") return { kind: "ready", envelope: result.value };
  if (result.kind === "pairing-required") return { kind: "pairing-required" };
  const retained =
    previous.kind === "ready"
      ? previous.envelope
      : previous.kind === "unavailable"
        ? previous.retained
        : null;
  return { kind: "unavailable", message: result.error.message, retained };
}

/** The envelope a screen can render right now, from any read state. */
export function displayableEnvelope<T>(read: SeoRead<T>): SeoEnvelope<T> | null {
  if (read.kind === "ready") return read.envelope;
  if (read.kind === "unavailable") return read.retained;
  return null;
}

export type SeoDisplayState =
  | "loading"
  | "current"
  | "unconfirmed"
  | "stale"
  | "unavailable"
  | "pairing-required";

/**
 * The visible data state: `current` for a live read, `unconfirmed` for what
 * this device stored at an earlier launch while the live read is in flight,
 * `stale` when the Gateway marked the payload stale or the latest
 * revalidation failed while older data remains displayable, `unavailable`
 * when nothing can render.
 */
export function displayState(read: SeoRead<unknown>): SeoDisplayState {
  switch (read.kind) {
    case "loading":
      return "loading";
    case "pairing-required":
      return "pairing-required";
    case "ready":
      if (read.envelope.freshness.stale) return "stale";
      return read.unconfirmed === true ? "unconfirmed" : "current";
    case "unavailable":
      return read.retained ? "stale" : "unavailable";
  }
}

const VERDICT_ORDER: readonly string[] = [
  "needs-attention",
  "needs-optimization",
  "declining",
  "no-visibility",
  "awaiting-launch",
  "new-visibility",
  "improving",
  "steady",
];

/** Counts pages per verdict, in Ranksta's severity order, others last. */
export function verdictSummary(
  pages: readonly SeoPageRow[],
): ReadonlyArray<{ readonly verdict: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const page of pages) counts.set(page.verdict, (counts.get(page.verdict) ?? 0) + 1);
  const known = VERDICT_ORDER.filter((verdict) => counts.has(verdict)).map((verdict) => ({
    verdict,
    count: counts.get(verdict) ?? 0,
  }));
  const unknown = [...counts.keys()]
    .filter((verdict) => !VERDICT_ORDER.includes(verdict))
    .sort()
    .map((verdict) => ({ verdict, count: counts.get(verdict) ?? 0 }));
  return [...known, ...unknown];
}

/** Counts mapped pages per index state (`indexed`/`not-indexed`/`unknown`). */
export function indexCoverage(pages: readonly SeoPageRow[]): {
  readonly indexed: number;
  readonly notIndexed: number;
  readonly unknown: number;
} {
  let indexed = 0;
  let notIndexed = 0;
  let unknown = 0;
  for (const page of pages) {
    if (!page.mapped) continue;
    if (page.indexed === "indexed") indexed += 1;
    else if (page.indexed === "not-indexed") notIndexed += 1;
    else unknown += 1;
  }
  return { indexed, notIndexed, unknown };
}

const ATTENTION_VERDICTS = new Set(["needs-attention", "needs-optimization", "declining"]);

/**
 * Pages needing attention, per the contract's interpretation rules: a
 * `not-indexed` target surfaces before its lack of visibility is diagnosed,
 * then Ranksta's own attention verdicts in severity order. No verdict is
 * recomputed here — this only selects and orders returned rows.
 */
export function pagesNeedingAttention(pages: readonly SeoPageRow[]): SeoPageRow[] {
  const notIndexed = pages.filter((page) => page.mapped && page.indexed === "not-indexed");
  const attention = pages.filter(
    (page) =>
      ATTENTION_VERDICTS.has(page.verdict) && !(page.mapped && page.indexed === "not-indexed"),
  );
  attention.sort(
    (left, right) => VERDICT_ORDER.indexOf(left.verdict) - VERDICT_ORDER.indexOf(right.verdict),
  );
  return [...notIndexed, ...attention];
}

/** Sums the true daily series into headline totals (no reclassification). */
export function trueTotalsFromHistory(days: readonly SeoHistoryDay[]): {
  readonly clicks: number;
  readonly impressions: number;
  readonly days: number;
} {
  let clicks = 0;
  let impressions = 0;
  for (const day of days) {
    clicks += day.clicks;
    impressions += day.impressions;
  }
  return { clicks, impressions, days: days.length };
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatCtr(ctr: number): string {
  return `${(ctr * 100).toFixed(1)}%`;
}

export function formatPosition(position: number): string {
  return position === 0 ? "—" : position.toFixed(1);
}

export function formatMetrics(metrics: SeoMetrics): string {
  return `${formatCount(metrics.clicks)} clicks · ${formatCount(metrics.impressions)} impr · ${formatCtr(metrics.ctr)} · pos ${formatPosition(metrics.position)}`;
}

function signed(value: number): string {
  return value >= 0 ? `+${formatCount(value)}` : formatCount(value);
}

/** Current window beside its deltas, exactly as Ranksta computed them. */
export function formatWindow(window: SeoWindow): string {
  return `${formatMetrics(window.current)} (${signed(window.deltaClicks)} clicks, ${signed(window.deltaImpressions)} impr)`;
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return "No window dates";
  return `${start} – ${end}`;
}

/** The freshness line every SEO screen shows near its data. */
export function describeFreshness(freshness: SeoFreshness): string {
  const synced = freshness.syncedAt ? `Synced ${freshness.syncedAt}` : "Sync time unknown";
  const range =
    freshness.rangeStart && freshness.rangeEnd
      ? ` · data ${freshness.rangeStart} – ${freshness.rangeEnd}`
      : "";
  return freshness.stale ? `STALE · ${synced}${range}` : `${synced}${range}`;
}

/** Index state with its inspection date when Ranksta supplied one. */
export function describeIndexState(indexed: string, inspectedAt: string | null): string {
  const label =
    indexed === "indexed"
      ? "Indexed"
      : indexed === "not-indexed"
        ? "Not indexed"
        : indexed === "unknown"
          ? "Index state unknown"
          : indexed;
  return inspectedAt ? `${label} (inspected ${inspectedAt})` : label;
}

/**
 * Labels the partial keyword visibility of query-derived scopes, per the
 * contract: anonymized long-tail rows are absent from `nonBrand` and
 * `allQueries`, so they never represent total traffic.
 */
export const PARTIAL_VISIBILITY_NOTE =
  "Query-derived numbers are partial: Google withholds anonymized long-tail rows. trueTotals are the real totals.";

export function summarizeSeoError(result: SeoResult<unknown>): string {
  if (result.kind === "pairing-required") {
    return "This Device Session expired or was revoked. Pair this device again.";
  }
  if (result.kind === "error") return result.error.message;
  return "The request failed.";
}

/** "4 minutes", for the cooldown the Gateway reports in seconds. */
export function formatRetryAfter(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < 60) return whole === 1 ? "1 second" : `${whole} seconds`;
  const minutes = Math.ceil(whole / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * What pull to refresh says about the sync it asked for.
 *
 * Refresh means "read live now, and ask Ranksta to look at Search Console
 * again". It does not mean "get newer data": Search Console lags by days, a
 * sync outlives the gesture by minutes, and the Gateway answers for the
 * request rather than the result. So every tone here is informational —
 * `requested` for a sync that is happening, `waiting` for the per-Site
 * cooldown, and `failed` only for a request the Gateway did not accept,
 * which leaves the live read the screen already shows untouched.
 */
export type SeoSyncNotice = {
  readonly tone: "requested" | "waiting" | "failed";
  readonly message: string;
};

export function describeSyncRequest(result: SeoResult<SeoSyncRequested>): SeoSyncNotice {
  if (result.kind === "ok") {
    const { state, retryAfterSeconds } = result.value.sync;
    if (state === "cooling-down") {
      return {
        tone: "waiting",
        message:
          retryAfterSeconds === null
            ? "This Site synced recently, so Ranksta did not ask Google again. Pull to refresh later."
            : `This Site synced recently, so Ranksta did not ask Google again. Pull to refresh in ${formatRetryAfter(retryAfterSeconds)}.`,
      };
    }
    return {
      tone: "requested",
      message:
        state === "already-running"
          ? "A sync is already running for this Site. Search Console lags by days, so new data can appear on a later refresh."
          : "Sync requested. Search Console lags by days, so a sync often changes nothing, and new data can appear on a later refresh.",
    };
  }
  return {
    tone: "failed",
    message: `The data above is a live read. Ranksta was not asked to sync: ${summarizeSeoError(result)}`,
  };
}
