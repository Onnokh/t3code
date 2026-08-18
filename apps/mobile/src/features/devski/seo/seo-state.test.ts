import { describe, expect, it } from "vite-plus/test";

import {
  applySeoResult,
  describeCoverage,
  describeIndexState,
  describeSyncOutcome,
  describeSyncedAt,
  displayState,
  displayableEnvelope,
  formatCtr,
  formatMetrics,
  formatWindow,
  indexCoverage,
  interpretSeoResponse,
  pagesNeedingAttention,
  readEnvelope,
  readSites,
  readSyncRequested,
  resolveSelectedSite,
  summarizeSeoError,
  trueTotalsFromHistory,
  verdictSummary,
  type SeoEnvelope,
  type SeoFreshness,
  type SeoHistoryData,
  type SeoPageRow,
  type SeoRead,
  type SeoSite,
} from "./seo-state";

const sites: SeoSite[] = [
  {
    id: "missingmounts",
    label: "Missingmounts",
    url: "https://missingmounts.com",
    available: true,
  },
  { id: "sleevy", label: "Sleevy", url: "https://sleevy.app", available: true },
];

const metrics = { impressions: 1200, clicks: 40, ctr: 0.033, position: 8.4 };

function pageRow(overrides: Partial<SeoPageRow>): SeoPageRow {
  return {
    path: "/guides/example",
    mapped: true,
    phase: "LIVE",
    priority: "P1",
    intent: "informational",
    clusters: [],
    keywords: ["example"],
    publishedAt: null,
    status: "live",
    indexed: "indexed",
    whyOpportunity: null,
    nonBrand: null,
    allQueries: null,
    trueTotals: null,
    baseline: null,
    signals: [],
    verdict: "steady",
    reasons: [],
    ...overrides,
  };
}

function envelope(data: SeoHistoryData, stale = false): SeoEnvelope<SeoHistoryData> {
  return {
    site: { id: "sleevy", label: "Sleevy", url: "https://sleevy.app" },
    data,
    freshness: {
      syncedAt: "2026-08-15T05:00:00.000Z",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-14",
      stale,
    },
    requestId: "req-1",
  };
}

const historyData: SeoHistoryData = {
  days: [
    {
      date: "2026-08-13",
      provisional: false,
      impressions: 100,
      clicks: 5,
      ctr: 0.05,
      position: 9.1,
    },
    {
      date: "2026-08-14",
      provisional: true,
      impressions: 90,
      clicks: 4,
      ctr: 0.044,
      position: 9.4,
    },
  ],
};

describe("interpretSeoResponse", () => {
  it("accepts a typed SeoEnvelope", () => {
    const result = interpretSeoResponse(
      { kind: "response", status: 200, body: envelope(historyData) },
      readEnvelope<SeoHistoryData>,
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.data.days).toHaveLength(2);
  });

  it("treats a 401 as pairing-required", () => {
    const result = interpretSeoResponse(
      { kind: "response", status: 401, body: { error: "device_session_invalid" } },
      readEnvelope,
    );
    expect(result.kind).toBe("pairing-required");
  });

  it("surfaces the typed Gateway error body", () => {
    const result = interpretSeoResponse(
      {
        kind: "response",
        status: 503,
        body: {
          code: "unavailable",
          message: "The SEO service is temporarily unavailable.",
          requestId: "req-9",
        },
      },
      readEnvelope,
    );
    expect(result).toEqual({
      kind: "error",
      error: {
        code: "unavailable",
        message: "The SEO service is temporarily unavailable.",
        requestId: "req-9",
      },
    });
  });

  it("reports a network failure as an unreachable service", () => {
    const result = interpretSeoResponse({ kind: "network-error" }, readEnvelope);
    expect(result.kind).toBe("error");
    expect(summarizeSeoError(result)).toBe("The SEO service is unreachable.");
  });

  it("rejects a 200 body without the envelope shape", () => {
    const result = interpretSeoResponse(
      { kind: "response", status: 200, body: { days: [] } },
      readEnvelope,
    );
    expect(result.kind).toBe("error");
  });
});

describe("readSites", () => {
  it("reads the configured Site catalog", () => {
    expect(readSites({ sites, requestId: "req-1" })).toEqual(sites);
  });

  it("rejects a malformed catalog", () => {
    expect(readSites({ sites: [{ id: 1 }] })).toBeNull();
    expect(readSites({})).toBeNull();
  });
});

describe("resolveSelectedSite", () => {
  it("keeps a persisted Site that is still configured", () => {
    expect(resolveSelectedSite("sleevy", sites)?.id).toBe("sleevy");
  });

  it("falls back to the first available Site on first install", () => {
    expect(resolveSelectedSite(undefined, sites)?.id).toBe("missingmounts");
  });

  it("skips an unavailable Site for the default but keeps an explicit choice", () => {
    const partiallyDown: SeoSite[] = [{ ...sites[0]!, available: false }, sites[1]!];
    expect(resolveSelectedSite(undefined, partiallyDown)?.id).toBe("sleevy");
    expect(resolveSelectedSite("missingmounts", partiallyDown)?.id).toBe("missingmounts");
  });

  it("drops a persisted Site that is no longer configured", () => {
    expect(resolveSelectedSite("gone", sites)?.id).toBe("missingmounts");
  });

  it("answers null without configured Sites", () => {
    expect(resolveSelectedSite("sleevy", [])).toBeNull();
  });
});

describe("applySeoResult and displayState", () => {
  it("moves loading to ready and classifies it current", () => {
    const read = applySeoResult({ kind: "loading" }, { kind: "ok", value: envelope(historyData) });
    expect(read.kind).toBe("ready");
    expect(displayState(read)).toBe("current");
  });

  it("classifies a Gateway-marked stale payload as stale", () => {
    const read = applySeoResult(
      { kind: "loading" },
      { kind: "ok", value: envelope(historyData, true) },
    );
    expect(displayState(read)).toBe("stale");
  });

  it("retains the last successful envelope when a revalidation fails", () => {
    const ready = applySeoResult({ kind: "loading" }, { kind: "ok", value: envelope(historyData) });
    const failed = applySeoResult(ready, {
      kind: "error",
      error: { code: "unavailable", message: "The SEO service is unreachable." },
    });
    expect(failed.kind).toBe("unavailable");
    expect(displayState(failed)).toBe("stale");
    expect(displayableEnvelope(failed)?.data.days).toHaveLength(2);
  });

  it("keeps the retained envelope across repeated failures", () => {
    const ready = applySeoResult({ kind: "loading" }, { kind: "ok", value: envelope(historyData) });
    const once = applySeoResult(ready, {
      kind: "error",
      error: { code: "unavailable", message: "down" },
    });
    const twice = applySeoResult(once, {
      kind: "error",
      error: { code: "unavailable", message: "still down" },
    });
    expect(displayableEnvelope(twice)?.requestId).toBe("req-1");
  });

  it("is unavailable with nothing retained when the first read fails", () => {
    const read = applySeoResult(
      { kind: "loading" },
      { kind: "error", error: { code: "unavailable", message: "down" } },
    );
    expect(displayState(read)).toBe("unavailable");
    expect(displayableEnvelope(read)).toBeNull();
  });

  it("signs out of the read on pairing-required", () => {
    const ready = applySeoResult({ kind: "loading" }, { kind: "ok", value: envelope(historyData) });
    const read = applySeoResult(ready, { kind: "pairing-required" });
    expect(read.kind).toBe("pairing-required");
    expect(displayState(read)).toBe("pairing-required");
  });

  it("classifies what this device stored at an earlier launch as unconfirmed", () => {
    expect(
      displayState({ kind: "ready", envelope: envelope(historyData), unconfirmed: true }),
    ).toBe("unconfirmed");
  });

  it("stops calling a stored envelope unconfirmed once a read replaces it", () => {
    const hydrated: SeoRead<SeoHistoryData> = {
      kind: "ready",
      envelope: envelope(historyData),
      unconfirmed: true,
    };
    expect(
      displayState(applySeoResult(hydrated, { kind: "ok", value: envelope(historyData) })),
    ).toBe("current");
  });

  it("retains a stored envelope when the read that would confirm it fails", () => {
    const hydrated: SeoRead<SeoHistoryData> = {
      kind: "ready",
      envelope: envelope(historyData),
      unconfirmed: true,
    };
    const failed = applySeoResult(hydrated, {
      kind: "error",
      error: { code: "unavailable", message: "The SEO service is unreachable." },
    });
    expect(displayState(failed)).toBe("stale");
    expect(displayableEnvelope(failed)?.requestId).toBe("req-1");
  });
});

describe("the sync operation", () => {
  const requested = (state: string): Record<string, unknown> => ({
    site: { id: "sleevy", label: "Sleevy", url: "https://sleevy.app" },
    sync: { state, requestedAt: "2026-08-18T09:00:00.000Z" },
    requestId: "req-2",
  });

  it("reads an accepted request", () => {
    const value = readSyncRequested(requested("started"));
    expect(value?.sync.state).toBe("started");
    expect(value?.site.id).toBe("sleevy");
  });

  it("refuses a body with an unknown sync state", () => {
    expect(readSyncRequested(requested("finished"))).toBeNull();
  });

  it("refuses the cooldown state the contract no longer has", () => {
    expect(readSyncRequested(requested("cooling-down"))).toBeNull();
  });

  it("refuses a body without a sync block", () => {
    expect(readSyncRequested({ site: { id: "sleevy" }, requestId: "req-2" })).toBeNull();
  });

  it("treats both accepted states as a success", () => {
    for (const state of ["started", "already-running"]) {
      const result = interpretSeoResponse(
        { kind: "response", status: 202, body: requested(state) },
        readSyncRequested,
      );
      expect(result.kind).toBe("ok");
    }
  });

  it("leaves a refused sync request an error the refresh can ignore", () => {
    const result = interpretSeoResponse(
      {
        kind: "response",
        status: 503,
        body: { code: "unavailable", message: "The SEO service is temporarily unavailable." },
      },
      readSyncRequested,
    );
    expect(result.kind).toBe("error");
  });

  it("has no sync-state wording left to render", async () => {
    // A refresh reports itself by the synced time it shows, so removing the
    // wording is the behaviour and its absence is what there is to pin. This
    // fails the moment a describe-the-request helper comes back.
    const exported = Object.keys(await import("./seo-state"));
    expect(exported).not.toContain("describeSyncRequest");
    expect(exported).not.toContain("formatRetryAfter");
  });
});

describe("Ranksta semantics helpers", () => {
  it("counts verdicts in severity order and keeps unknown verdicts display-safe", () => {
    const summary = verdictSummary([
      pageRow({ verdict: "steady" }),
      pageRow({ path: "/a", verdict: "needs-attention" }),
      pageRow({ path: "/b", verdict: "needs-attention" }),
      pageRow({ path: "/c", verdict: "brand-new-verdict" }),
    ]);
    expect(summary).toEqual([
      { verdict: "needs-attention", count: 2 },
      { verdict: "steady", count: 1 },
      { verdict: "brand-new-verdict", count: 1 },
    ]);
  });

  it("counts index coverage over mapped pages only", () => {
    const coverage = indexCoverage([
      pageRow({ indexed: "indexed" }),
      pageRow({ path: "/a", indexed: "not-indexed" }),
      pageRow({ path: "/b", indexed: "unknown" }),
      pageRow({ path: "/c", mapped: false, indexed: "not-indexed" }),
    ]);
    expect(coverage).toEqual({ indexed: 1, notIndexed: 1, unknown: 1 });
  });

  it("surfaces not-indexed targets before attention verdicts and never recomputes them", () => {
    const attention = pagesNeedingAttention([
      pageRow({ path: "/fine", verdict: "improving" }),
      pageRow({ path: "/declining", verdict: "declining" }),
      pageRow({ path: "/hidden", verdict: "no-visibility", indexed: "not-indexed" }),
      pageRow({ path: "/urgent", verdict: "needs-attention" }),
    ]);
    expect(attention.map((page) => page.path)).toEqual(["/hidden", "/urgent", "/declining"]);
  });

  it("sums the true daily series into headline totals", () => {
    expect(trueTotalsFromHistory(historyData.days)).toEqual({
      clicks: 9,
      impressions: 190,
      days: 2,
    });
    expect(trueTotalsFromHistory([])).toEqual({ clicks: 0, impressions: 0, days: 0 });
  });
});

describe("formatting", () => {
  it("formats metrics, windows, and ctr for display", () => {
    expect(formatCtr(0.033)).toBe("3.3%");
    expect(formatMetrics(metrics)).toBe("40 clicks · 1,200 impr · 3.3% · pos 8.4");
    expect(
      formatWindow({
        current: metrics,
        previous: { impressions: 900, clicks: 22, ctr: 0.024, position: 11.2 },
        deltaImpressions: 300,
        deltaClicks: 18,
      }),
    ).toBe("40 clicks · 1,200 impr · 3.3% · pos 8.4 (+18 clicks, +300 impr)");
  });

  it("describes index states with the inspection date when available", () => {
    expect(describeIndexState("indexed", "2026-08-10")).toBe("Indexed (inspected 2026-08-10)");
    expect(describeIndexState("not-indexed", null)).toBe("Not indexed");
    expect(describeIndexState("unknown", null)).toBe("Index state unknown");
    expect(describeIndexState("future-state", null)).toBe("future-state");
  });

  it("marks stale coverage visibly and shows the data range", () => {
    expect(
      describeCoverage({
        syncedAt: "2026-08-15T05:00:00.000Z",
        rangeStart: "2026-08-01",
        rangeEnd: "2026-08-14",
        stale: false,
      }),
    ).toBe("Data 2026-08-01 – 2026-08-14");
    expect(
      describeCoverage({ syncedAt: null, rangeStart: null, rangeEnd: null, stale: true }),
    ).toBe("STALE · Data window unknown");
  });
});

describe("the last synced time", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  it("shows how long ago the status read says the data arrived", () => {
    expect(describeSyncedAt(hoursAgo(3))).toBe("Last synced 3h ago");
    expect(describeSyncedAt(hoursAgo(50))).toBe("Last synced 2d ago");
  });

  it("reads the synced time off an envelope whether or not the payload is stale", () => {
    const synced = (stale: boolean): SeoFreshness => ({
      ...envelope(historyData, stale).freshness,
      syncedAt: hoursAgo(1),
    });
    // A stale payload came from the Gateway's outage fallback and still
    // carries the synced time it remembered; staleness is not the data's age.
    expect(describeSyncedAt(synced(true).syncedAt)).toBe("Last synced 1h ago");
    expect(describeSyncedAt(synced(false).syncedAt)).toBe("Last synced 1h ago");
  });

  it("never invents a time for a read that reports none", () => {
    // Every read but `status` answers null, and null means the Gateway did not
    // ask — not that the data arrived just now.
    const plain: SeoFreshness = { ...envelope(historyData).freshness, syncedAt: null };
    expect(describeSyncedAt(plain.syncedAt)).toBe("Last sync time unknown");
    expect(describeSyncedAt(null)).toBe("Last sync time unknown");
  });

  it("treats an unreadable instant as unknown rather than as this minute", () => {
    expect(describeSyncedAt("not an instant")).toBe("Last sync time unknown");
    expect(describeSyncedAt("")).toBe("Last sync time unknown");
  });
});

describe("what a sync request came to", () => {
  it("says nothing before this device has asked for one", () => {
    // A screen that has not been pulled has no gesture to report, and a
    // sentence about a sync nobody asked for is noise.
    expect(describeSyncOutcome({ kind: "none" })).toBeNull();
  });

  it("reports an accepted sync the same way whichever lock Ranksta took", () => {
    // The Gateway answers 202 for both, and which one it was tells the owner
    // nothing they can act on: Ranksta is going to look at Search Console.
    expect(describeSyncOutcome({ kind: "requested", state: "started" })).toBe("Sync requested");
    expect(describeSyncOutcome({ kind: "requested", state: "already-running" })).toBe(
      "Sync requested",
    );
  });

  it("makes a refused sync visible, and says why", () => {
    // The property this whole type exists for. A refused sync used to be
    // dropped on the floor, which left the screen identical to a successful
    // refresh — no error, no banner, nothing.
    expect(
      describeSyncOutcome({ kind: "refused", message: "The SEO service is unreachable." }),
    ).toBe("Sync failed: The SEO service is unreachable.");
  });

  it("tells an accepted sync apart from a refused one even though neither moves the synced time", () => {
    // The bug this pins. Ranksta re-fetches a finalized day only once its
    // cached copy has aged past the reconciliation floor, so for hours after a
    // real sync every further sync correctly fetches nothing and stamps no new
    // arrival instant. The synced time is therefore identical in both cases,
    // and the outcome line is the only thing that separates "asked, and there
    // was nothing new" from "never asked successfully at all".
    const unmoved = "2026-08-18T12:21:54Z";
    const accepted = describeSyncOutcome({ kind: "requested", state: "started" });
    const refused = describeSyncOutcome({
      kind: "refused",
      message: "The SEO service is temporarily unavailable.",
    });

    expect(describeSyncedAt(unmoved)).toBe(describeSyncedAt(unmoved));
    expect(accepted).not.toBe(refused);
    expect(accepted).not.toBeNull();
    expect(refused).not.toBeNull();
  });
});
