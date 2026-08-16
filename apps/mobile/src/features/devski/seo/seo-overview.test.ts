import { describe, expect, it } from "vite-plus/test";

import {
  barIndexAt,
  buildDailyChart,
  formatShortDate,
  recentDays,
  registryRow,
} from "./seo-overview";
import type { SeoHistoryDay, SeoRegistryTarget } from "./seo-state";

function day(date: string, impressions: number, clicks = 0, provisional = false): SeoHistoryDay {
  return { date, provisional, impressions, clicks, ctr: 0, position: 0 };
}

const size = { width: 100, height: 50 };

describe("buildDailyChart", () => {
  it("draws nothing without days or without a box", () => {
    expect(buildDailyChart([], size).bars).toEqual([]);
    expect(buildDailyChart([day("2026-08-13", 5)], { width: 0, height: 50 }).bars).toEqual([]);
  });

  it("makes the bar the day's impressions and its solid part the clicks", () => {
    const chart = buildDailyChart([day("2026-08-12", 10, 5), day("2026-08-13", 5)], size);
    expect(chart.slotWidth).toBe(50);
    expect(chart.bars[0]).toEqual({
      date: "2026-08-12",
      provisional: false,
      x: 1,
      width: 48,
      top: 0,
      height: 50,
      clicksTop: 25,
      clicksHeight: 25,
    });
    expect(chart.bars[1]?.height).toBe(25);
    expect(chart.bars[1]?.clicksHeight).toBe(0);
  });

  it("keeps a fully clicked day inside its own bar", () => {
    const chart = buildDailyChart([day("2026-08-13", 10, 10)], size);
    expect(chart.bars[0]?.height).toBe(50);
    expect(chart.bars[0]?.clicksHeight).toBe(50);
  });

  it("scales from zero, so a low series reads low", () => {
    const chart = buildDailyChart([day("2026-08-12", 1), day("2026-08-13", 2)], size);
    expect(chart.bars[0]?.height).toBe(25);
    expect(chart.bars[1]?.height).toBe(50);
  });

  it("labels the peak, its midpoint, and zero", () => {
    const chart = buildDailyChart([day("2026-08-12", 0), day("2026-08-13", 13)], size);
    expect(chart.ticks).toEqual([
      { value: 13, y: 0 },
      { value: 7, y: 23.08 },
      { value: 0, y: 50 },
    ]);
  });

  it("collapses the labels to one when nothing was seen", () => {
    const chart = buildDailyChart([day("2026-08-12", 0), day("2026-08-13", 0)], size);
    expect(chart.ticks).toEqual([{ value: 0, y: 50 }]);
    expect(chart.bars.every((bar) => bar.height === 0)).toBe(true);
  });
});

describe("barIndexAt", () => {
  const chart = buildDailyChart([day("2026-08-12", 5), day("2026-08-13", 10)], size);

  it("answers for the whole slot, not just the drawn bar", () => {
    expect(barIndexAt(0, chart)).toBe(0);
    expect(barIndexAt(49.9, chart)).toBe(0);
    expect(barIndexAt(50, chart)).toBe(1);
    expect(barIndexAt(99, chart)).toBe(1);
  });

  it("answers with nothing outside the plot, or with nothing drawn", () => {
    expect(barIndexAt(-1, chart)).toBe(null);
    expect(barIndexAt(101, chart)).toBe(null);
    expect(barIndexAt(10, buildDailyChart([], size))).toBe(null);
  });
});

describe("recentDays", () => {
  it("returns the newest days first, capped", () => {
    const days = [day("2026-08-11", 1), day("2026-08-12", 2), day("2026-08-13", 3, 0, true)];
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
