import { useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { G, Rect } from "react-native-svg";

import { AppText as Text } from "../../../components/AppText";
import { useThemeColor } from "../../../lib/useThemeColor";
import { barIndexAt, buildDailyChart, formatShortDate } from "./seo-overview";
import { formatCount, formatCtr, formatPosition, type SeoHistoryDay } from "./seo-state";

const CHART_HEIGHT = 120;
const LABEL_GUTTER = 40;
const LABEL_HEIGHT = 14;
const TOOLTIP_WIDTH = 150;

/** The clicks segment is solid; the rest of the impressions bar is faint. */
const CLICKS_OPACITY = 1;
const IMPRESSIONS_OPACITY = 0.22;
/** A provisional day is still being revised by Google, and reads quieter. */
const PROVISIONAL_FADE = 0.45;
/** How much darker the chosen day's impressions read than the rest. */
const SELECTED_LIFT = 2.4;

function Swatch(props: {
  readonly color: string;
  readonly opacity: number;
  readonly label: string;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: props.color,
          opacity: props.opacity,
        }}
      />
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
    </View>
  );
}

/**
 * The daily series for the overview window: one column per day, the whole
 * bar its impressions and the solid part of it the clicks they produced.
 * Tapping a column reads that day out. Static — the app runs on
 * high-refresh displays and nothing here repaints on its own.
 */
export function SeoDailyChart(props: {
  readonly days: readonly SeoHistoryDay[];
  readonly loading: boolean;
}) {
  const [plotWidth, setPlotWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const barColor = useThemeColor("--color-foreground") as string;

  const chart = buildDailyChart(props.days, { width: plotWidth, height: CHART_HEIGHT });
  // A shorter series after a refresh must not leave a selection pointing
  // past its end.
  const selectedBar = selected !== null ? (chart.bars[selected] ?? null) : null;
  const selectedDay = selected !== null ? (props.days[selected] ?? null) : null;

  const first = props.days[0];
  const last = props.days[props.days.length - 1];

  if (props.days.length === 0) {
    return (
      <View className="rounded-2xl border border-border bg-card px-4 py-4">
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-sm text-foreground-muted">
            {props.loading ? "Loading daily totals…" : "No daily totals yet for this Site."}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="rounded-2xl border border-border bg-card px-4 py-4">
      <View className="mb-3 flex-row items-center justify-end gap-3">
        <Swatch color={barColor} opacity={CLICKS_OPACITY} label="clicks" />
        <Swatch color={barColor} opacity={IMPRESSIONS_OPACITY} label="impressions" />
      </View>
      <View className="flex-row">
        <View style={{ width: LABEL_GUTTER, height: CHART_HEIGHT }}>
          {chart.ticks.map((tick) => (
            <Text
              key={tick.value}
              className="absolute text-xs text-foreground-muted"
              style={{ top: tick.y - LABEL_HEIGHT / 2 }}
            >
              {formatCount(tick.value)}
            </Text>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Daily impressions and clicks. Tap a day to read its numbers."
          className="flex-1"
          style={{ height: CHART_HEIGHT }}
          onLayout={(event: LayoutChangeEvent) => setPlotWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            const index = barIndexAt(event.nativeEvent.locationX, chart);
            setSelected((current) => (current === index ? null : index));
          }}
        >
          {plotWidth > 0 ? (
            <Svg width={plotWidth} height={CHART_HEIGHT}>
              <G>
                {chart.bars.map((bar, index) => {
                  const fade = bar.provisional ? PROVISIONAL_FADE : 1;
                  // The chosen day darkens rather than gaining a band
                  // behind it, which would read as a taller bar.
                  const lift = index === selected ? SELECTED_LIFT : 1;
                  return (
                    <G key={bar.date}>
                      <Rect
                        x={bar.x}
                        y={bar.top}
                        width={bar.width}
                        height={bar.height}
                        fill={barColor}
                        opacity={Math.min(1, IMPRESSIONS_OPACITY * fade * lift)}
                        rx={1}
                      />
                      {bar.clicksHeight > 0 ? (
                        <Rect
                          x={bar.x}
                          y={bar.clicksTop}
                          width={bar.width}
                          height={bar.clicksHeight}
                          fill={barColor}
                          opacity={CLICKS_OPACITY * fade}
                          rx={1}
                        />
                      ) : null}
                    </G>
                  );
                })}
              </G>
            </Svg>
          ) : null}
          {selectedBar && selectedDay ? (
            <View
              pointerEvents="none"
              className="absolute rounded-xl border border-border bg-card px-3 py-2"
              style={{
                top: 0,
                width: TOOLTIP_WIDTH,
                // A tall bar leaves no room above itself, so the readout
                // takes the far half of the plot instead of covering the
                // day it describes. It ignores touches, so the days
                // beneath it stay tappable.
                left:
                  selectedBar.x + selectedBar.width / 2 < plotWidth / 2
                    ? Math.max(0, plotWidth - TOOLTIP_WIDTH)
                    : 0,
              }}
            >
              <Text className="text-xs font-t3-bold text-foreground">
                {formatShortDate(selectedDay.date)}
                {selectedDay.provisional ? " · provisional" : ""}
              </Text>
              <Text className="mt-0.5 text-xs text-foreground-muted">
                {`${formatCount(selectedDay.impressions)} impr · ${formatCount(selectedDay.clicks)} clicks`}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {`${formatCtr(selectedDay.ctr)} · pos ${formatPosition(selectedDay.position)}`}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <View className="flex-row justify-between" style={{ paddingLeft: LABEL_GUTTER }}>
        <Text className="text-xs text-foreground-muted">
          {first ? formatShortDate(first.date) : ""}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {last ? formatShortDate(last.date) : ""}
        </Text>
      </View>
    </View>
  );
}
