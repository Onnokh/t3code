/**
 * Pure shapes for the SEO overview: the 28-day impression chart geometry,
 * the newest daily rows, and the compact date column. Kept out of the
 * screen so the geometry can be tested without a renderer. Nothing here
 * recomputes a Ranksta metric — it only positions returned numbers.
 */

import type { SeoHistoryDay } from "./seo-state";

/** The overview reads one window; the History screen owns the long view. */
export const OVERVIEW_HISTORY_DAYS = 28;
export const OVERVIEW_DAILY_ROWS = 5;
export const OVERVIEW_LOG_ENTRIES = 3;

export type ChartPoint = { readonly x: number; readonly y: number };

export type ChartTick = { readonly value: number; readonly y: number };

export type ImpressionChart = {
  /** SVG path for the impression line, empty when there is nothing to draw. */
  readonly line: string;
  readonly points: readonly ChartPoint[];
  /** The newest day, marked so the line reads left-to-right in time. */
  readonly last: ChartPoint | null;
  readonly ticks: readonly ChartTick[];
};

const EMPTY_CHART: ImpressionChart = { line: "", points: [], last: null, ticks: [] };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Positions one impression series in a box of `size`, oldest day at the
 * left. The scale starts at zero so a low-traffic Site reads as low rather
 * than being stretched to fill the box, and the ticks label that scale.
 */
export function buildImpressionChart(
  days: readonly SeoHistoryDay[],
  size: { readonly width: number; readonly height: number },
): ImpressionChart {
  if (days.length === 0 || size.width <= 0 || size.height <= 0) return EMPTY_CHART;

  const peak = days.reduce((highest, day) => Math.max(highest, day.impressions), 0);
  const yOf = (value: number) =>
    peak === 0 ? size.height : size.height - (value / peak) * size.height;

  const points = days.map((day, index) => ({
    x: round(days.length === 1 ? size.width / 2 : (index / (days.length - 1)) * size.width),
    y: round(yOf(day.impressions)),
  }));

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  // Peak, midpoint, and zero — the same three labels the chart is read
  // against. Duplicates collapse when the peak is 0 or 1.
  const values = [peak, Math.round(peak / 2), 0].filter(
    (value, index, all) => all.indexOf(value) === index,
  );

  return {
    line,
    points,
    last: points[points.length - 1] ?? null,
    ticks: values.map((value) => ({ value, y: round(yOf(value)) })),
  };
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

/** `2026-08-13` becomes `08-13`, the overview's compact date column. */
export function formatShortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}
