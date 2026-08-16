import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";

import { AppText as Text } from "../../../components/AppText";
import { useThemeColor } from "../../../lib/useThemeColor";
import { buildImpressionChart, formatShortDate } from "./seo-overview";
import { formatCount, type SeoHistoryDay } from "./seo-state";

const CHART_HEIGHT = 120;
const LABEL_GUTTER = 34;
const LABEL_HEIGHT = 14;
/** Room for the stroke and the end marker, so neither is clipped. */
const PLOT_INSET = 6;

/**
 * The impression series for the overview window: one line, a marker on the
 * newest day, and the scale it is read against. Static — the app runs on
 * high-refresh displays and nothing here repaints on its own.
 */
export function SeoImpressionChart(props: {
  readonly days: readonly SeoHistoryDay[];
  readonly loading: boolean;
}) {
  const [plotWidth, setPlotWidth] = useState(0);
  const lineColor = useThemeColor("--color-foreground");
  const cardColor = useThemeColor("--color-card");

  const chart = buildImpressionChart(props.days, {
    width: plotWidth - PLOT_INSET * 2,
    height: CHART_HEIGHT - PLOT_INSET * 2,
  });

  const first = props.days[0];
  const last = props.days[props.days.length - 1];

  return (
    <View className="rounded-2xl border border-border bg-card px-4 py-4">
      {props.days.length === 0 ? (
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-sm text-foreground-muted">
            {props.loading ? "Loading daily totals…" : "No daily totals yet for this Site."}
          </Text>
        </View>
      ) : (
        <>
          <View className="flex-row">
            <View style={{ width: LABEL_GUTTER, height: CHART_HEIGHT }}>
              {chart.ticks.map((tick) => (
                <Text
                  key={tick.value}
                  className="absolute text-xs text-foreground-muted"
                  style={{ top: tick.y + PLOT_INSET - LABEL_HEIGHT / 2 }}
                >
                  {formatCount(tick.value)}
                </Text>
              ))}
            </View>
            <View
              className="flex-1"
              style={{ height: CHART_HEIGHT }}
              onLayout={(event: LayoutChangeEvent) => setPlotWidth(event.nativeEvent.layout.width)}
            >
              {plotWidth > 0 ? (
                <Svg width={plotWidth} height={CHART_HEIGHT}>
                  <G x={PLOT_INSET} y={PLOT_INSET}>
                    <Path
                      d={chart.line}
                      stroke={lineColor as string}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                    {chart.last ? (
                      <Circle
                        cx={chart.last.x}
                        cy={chart.last.y}
                        r={4}
                        stroke={lineColor as string}
                        strokeWidth={2}
                        fill={cardColor as string}
                      />
                    ) : null}
                  </G>
                </Svg>
              ) : null}
            </View>
          </View>
          <View className="flex-row justify-between" style={{ paddingLeft: LABEL_GUTTER }}>
            <Text className="text-xs text-foreground-muted">
              {first ? formatShortDate(first.date) : ""}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {last ? formatShortDate(last.date) : ""}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
