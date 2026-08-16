import { describe, expect, it } from "vite-plus/test";

import { buildImpressionChart, formatShortDate, recentDays, registryRow } from "./seo-overview";
import type { SeoHistoryDay, SeoRegistryTarget } from "./seo-state";

function day(date: string, impressions: number, provisional = false): SeoHistoryDay {
  return { date, provisional, impressions, clicks: 0, ctr: 0, position: 0 };
}

const size = { width: 100, height: 50 };

describe("buildImpressionChart", () => {
  it("draws nothing without days or without a box", () => {
    expect(buildImpressionChart([], size).line).toBe("");
    expect(buildImpressionChart([day("2026-08-13", 5)], { width: 0, height: 50 }).line).toBe("");
  });

  it("spreads the days across the width, oldest first", () => {
    const chart = buildImpressionChart(
      [day("2026-08-11", 0), day("2026-08-12", 5), day("2026-08-13", 10)],
      size,
    );
    expect(chart.points).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 25 },
      { x: 100, y: 0 },
    ]);
    expect(chart.line).toBe("M0,50 L50,25 L100,0");
    expect(chart.last).toEqual({ x: 100, y: 0 });
  });

  it("centres a single day rather than dividing by zero", () => {
    const chart = buildImpressionChart([day("2026-08-13", 7)], size);
    expect(chart.points).toEqual([{ x: 50, y: 0 }]);
  });

  it("scales from zero, so a low series reads low", () => {
    const chart = buildImpressionChart([day("2026-08-12", 1), day("2026-08-13", 2)], size);
    expect(chart.points).toEqual([
      { x: 0, y: 25 },
      { x: 100, y: 0 },
    ]);
  });

  it("labels the peak, its midpoint, and zero", () => {
    const chart = buildImpressionChart([day("2026-08-12", 0), day("2026-08-13", 13)], size);
    expect(chart.ticks).toEqual([
      { value: 13, y: 0 },
      { value: 7, y: 23.08 },
      { value: 0, y: 50 },
    ]);
  });

  it("collapses the labels to one when nothing was seen", () => {
    const chart = buildImpressionChart([day("2026-08-12", 0), day("2026-08-13", 0)], size);
    expect(chart.ticks).toEqual([{ value: 0, y: 50 }]);
    expect(chart.line).toBe("M0,50 L100,50");
  });
});

describe("recentDays", () => {
  it("returns the newest days first, capped", () => {
    const days = [day("2026-08-11", 1), day("2026-08-12", 2), day("2026-08-13", 3, true)];
    expect(recentDays(days, 2).map((entry) => entry.date)).toEqual(["2026-08-13", "2026-08-12"]);
  });

  it("leaves the caller's series untouched", () => {
    const days = [day("2026-08-11", 1), day("2026-08-12", 2)];
    recentDays(days);
    expect(days.map((entry) => entry.date)).toEqual(["2026-08-11", "2026-08-12"]);
  });
});

function target(overrides: Partial<SeoRegistryTarget> = {}): SeoRegistryTarget {
  return {
    targetUrl: "/chrome-extension",
    phase: "LIVE",
    state: "measuring",
    indexed: "indexed",
    coverageState: "Submitted and indexed",
    inspectedAt: "2026-08-15",
    priority: "P0",
    intent: "product",
    publishedAt: "2026-07-16",
    baselineDate: null,
    status: "Published",
    whyOpportunity: null,
    measuredFrom: "2026-07-17",
    window: { impressions: 7, clicks: 0, ctr: 0, position: 36.4 },
    baseline: null,
    keywords: [
      { keyword: "chrome read later extension", cluster: "capture", intent: "p", country: "USA" },
    ],
    ...overrides,
  };
}

describe("registryRow", () => {
  it("reads as priority, target, window impressions, and phase", () => {
    expect(registryRow(target())).toEqual(["P0", "/chrome-extension", "7", "LIVE"]);
  });

  it("marks an inventory-only page rather than borrowing a priority", () => {
    expect(registryRow(target({ priority: null, phase: "PAGE" }))[0]).toBe("—");
  });

  it("groups the thousands a large Site reaches", () => {
    const large = target({ window: { impressions: 5791, clicks: 854, ctr: 0.15, position: 4.2 } });
    expect(registryRow(large)[2]).toBe("5,791");
  });
});

describe("formatShortDate", () => {
  it("drops the year from an ISO date", () => {
    expect(formatShortDate("2026-08-13")).toBe("08-13");
  });

  it("shows an unexpected date exactly as it arrived", () => {
    expect(formatShortDate("last Tuesday")).toBe("last Tuesday");
  });
});
