/**
 * Pure shapes for the SEO overview: the daily chart's geometry and hit
 * testing, the newest daily rows, and the compact date column. Kept out of
 * the screen so the geometry can be tested without a renderer. Nothing
 * here recomputes a Ranksta metric — it only positions returned numbers.
 */

import { formatCount, type SeoHistoryDay, type SeoRegistryTarget } from "./seo-state";

/** The overview reads one window; the History screen owns the long view. */
export const OVERVIEW_HISTORY_DAYS = 28;
export const OVERVIEW_DAILY_ROWS = 5;
export const OVERVIEW_LOG_ENTRIES = 3;
export const OVERVIEW_REGISTRY_ROWS = 5;

export type ChartTick = { readonly value: number; readonly y: number };

/**
 * One day as a stacked column. The whole bar is that day's impressions;
 * the clicks segment is the part of them that was clicked. Clicks are a
 * subset of impressions, never an addition to them, so the two are drawn
 * inside one bar rather than piled on top of each other.
 */
export type ChartBar = {
  readonly date: string;
  readonly provisional: boolean;
  readonly x: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
  readonly clicksTop: number;
  readonly clicksHeight: number;
};

export type DailyChart = {
  readonly bars: readonly ChartBar[];
  readonly ticks: readonly ChartTick[];
  /** One day's share of the width, including the gap after its bar. */
  readonly slotWidth: number;
};

const EMPTY_CHART: DailyChart = { bars: [], ticks: [], slotWidth: 0 };

/** Breathing room between columns; a bar never narrows below one point. */
const BAR_GAP = 2;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Positions one daily series in a box of `size`, oldest day at the left.
 * The scale starts at zero and is bounded by the impression peak, so a
 * low-traffic Site reads as low rather than being stretched to fill the
 * box, and the ticks label that scale.
 */
export function buildDailyChart(
  days: readonly SeoHistoryDay[],
  size: { readonly width: number; readonly height: number },
): DailyChart {
  if (days.length === 0 || size.width <= 0 || size.height <= 0) return EMPTY_CHART;

  // Clicks can never exceed impressions, so the impression peak bounds
  // both series and one axis serves them.
  const peak = days.reduce((highest, day) => Math.max(highest, day.impressions), 0);
  const heightOf = (value: number) => (peak === 0 ? 0 : (value / peak) * size.height);
  const slotWidth = size.width / days.length;
  const barWidth = Math.max(1, round(slotWidth - BAR_GAP));

  const bars = days.map((day, index) => {
    const height = round(heightOf(day.impressions));
    const clicksHeight = round(heightOf(day.clicks));
    return {
      date: day.date,
      provisional: day.provisional,
      x: round(index * slotWidth + (slotWidth - barWidth) / 2),
      width: barWidth,
      top: round(size.height - height),
      height,
      clicksTop: round(size.height - clicksHeight),
      clicksHeight,
    };
  });

  // Peak, midpoint, and zero — the same three labels the chart is read
  // against. Duplicates collapse when the peak is 0 or 1.
  const values = [peak, Math.round(peak / 2), 0].filter(
    (value, index, all) => all.indexOf(value) === index,
  );

  return {
    bars,
    ticks: values.map((value) => ({
      value,
      y: round(peak === 0 ? size.height : size.height - heightOf(value)),
    })),
    slotWidth: round(slotWidth),
  };
}

/**
 * The day a tap at `x` belongs to. The whole slot answers, not just the
 * drawn bar, so a day with no impressions is still reachable and a narrow
 * column does not demand a precise finger.
 */
export function barIndexAt(x: number, chart: DailyChart): number | null {
  if (chart.bars.length === 0 || chart.slotWidth <= 0) return null;
  const index = Math.floor(x / chart.slotWidth);
  return index >= 0 && index < chart.bars.length ? index : null;
}

/**
 * The newest days first. Ranksta returns the series oldest-first, and
 * Hermes has no `toReversed`, so this reverses a copy.
 */
export function recentDays(
  days: readonly SeoHistoryDay[],
  limit: number = OVERVIEW_DAILY_ROWS,
): readonly SeoHistoryDay[] {
  return [...days].reverse().slice(0, limit);
}

/** One Registry row, in the column order the overview lays it out. */
export type RegistryRow = readonly [
  priority: string,
  target: string,
  impressions: string,
  phase: string,
];

/**
 * One Registry target as its four columns: Ranksta's priority, the target
 * page, what the window measured, and Ranksta's phase. An inventory-only
 * page carries no priority and says so rather than borrowing one.
 */
export function registryRow(target: SeoRegistryTarget): RegistryRow {
  return [
    target.priority ?? "—",
    target.targetUrl,
    formatCount(target.window.impressions),
    target.phase,
  ];
}

/** `2026-08-13` becomes `08-13`, the overview's compact date column. */
export function formatShortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}
