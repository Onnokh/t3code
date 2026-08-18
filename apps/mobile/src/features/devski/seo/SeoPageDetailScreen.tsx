import { useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { type StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { FieldRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead, useSeoRefresh } from "./seo-api";
import {
  describeIndexState,
  displayableEnvelope,
  formatDateRange,
  formatMetrics,
  formatWindow,
  PARTIAL_VISIBILITY_NOTE,
} from "./seo-state";
import { SeoFreshnessBanner } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

type Params = { readonly path: string };

const VISIBLE_SERIES_DAYS = 14;

/**
 * Full report for one canonical page path: plan, rationale, verdict
 * reasons, index state, daily series, top queries, baseline, signals, and
 * logged actions — all as Ranksta returned them.
 */
export function SeoPageDetailScreen({ route }: StaticScreenProps<Params>) {
  const { path } = route.params;
  const client = useSeoClient();
  const { selectedSiteId } = useSeoSitePreference();

  const fetcher = useMemo(
    () => (client && selectedSiteId ? () => client.page(selectedSiteId, path) : null),
    [client, selectedSiteId, path],
  );
  const { read, reload } = useSeoRead(
    selectedSiteId ? `page:${selectedSiteId}:${path}` : null,
    fetcher,
  );
  // Pull to refresh reads live and asks Ranksta to look at Search Console
  // again. It resolves on the read, never on the sync.
  const refresh = useSeoRefresh(client, selectedSiteId, reload);
  const envelope = displayableEnvelope(read);
  const page = envelope?.data ?? null;

  if (!client || !selectedSiteId) {
    return (
      <View className="flex-1 bg-screen">
        <EmptyState
          variant="plain"
          title="No Site selected"
          detail="Choose a Site on the SEO home screen."
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 20 }}
      refreshControl={
        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.refresh} />
      }
    >
      <Text className="font-t3-bold text-foreground" selectable>
        {path}
      </Text>
      <SeoFreshnessBanner read={read} />
      {page ? (
        <>
          <SectionTitle>Verdict</SectionTitle>
          <View className="rounded-2xl border border-border bg-card px-4 py-2">
            <FieldRow label="Verdict" value={page.verdict} />
            <FieldRow label="Phase" value={page.phase} />
            <FieldRow
              label="Mapped"
              value={page.mapped ? "Keyword target" : "Not in the Registry"}
            />
            {page.state ? <FieldRow label="Progress" value={page.state} /> : null}
          </View>
          {page.reasons.length > 0 ? (
            page.reasons.map((reason, index) => (
              <Text key={index} className="text-sm text-foreground-muted">
                • {reason}
              </Text>
            ))
          ) : (
            <Text className="text-sm text-foreground-muted">No verdict reasons returned.</Text>
          )}

          <SectionTitle>Index state</SectionTitle>
          <View className="rounded-2xl border border-border bg-card px-4 py-2">
            <FieldRow label="Index" value={describeIndexState(page.indexed, page.inspectedAt)} />
            {page.coverageState ? <FieldRow label="Coverage" value={page.coverageState} /> : null}
            {page.measuredFrom ? (
              <FieldRow label="Measured from" value={page.measuredFrom} />
            ) : null}
          </View>
          {page.mapped && page.indexed === "not-indexed" ? (
            <Text className="text-sm text-foreground-muted">
              This target is not indexed — resolve indexing before diagnosing its visibility.
            </Text>
          ) : null}

          <SectionTitle>Plan</SectionTitle>
          {page.plan.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No Registry plan rows for this page.
            </Text>
          ) : (
            page.plan.map((entry, index) => (
              <View
                key={`${entry.keyword}:${index}`}
                className="rounded-2xl border border-border bg-card px-4 py-2"
              >
                <FieldRow label="Keyword" value={entry.keyword || "(inventory-only)"} />
                <FieldRow label="Cluster" value={entry.cluster || "—"} />
                <FieldRow label="Intent" value={entry.intent || "—"} />
                <FieldRow label="Priority" value={entry.priority || "—"} />
                <FieldRow label="Status" value={entry.status || "—"} />
                <FieldRow label="Published" value={entry.publishedAt ?? "—"} />
                <FieldRow label="Baseline date" value={entry.baselineDate ?? "—"} />
                {entry.whyOpportunity ? (
                  <FieldRow label="Why" value={entry.whyOpportunity} />
                ) : null}
              </View>
            ))
          )}

          <SectionTitle>True totals</SectionTitle>
          {page.trueTotals ? (
            <Text className="text-sm text-foreground" selectable>
              {formatWindow(page.trueTotals)}
            </Text>
          ) : (
            <Text className="text-sm text-foreground-muted">
              No true totals for this page in the current window.
            </Text>
          )}

          <SectionTitle>{`Performance (${page.performance.scope})`}</SectionTitle>
          <Text className="text-xs text-foreground-muted">{PARTIAL_VISIBILITY_NOTE}</Text>
          <View className="rounded-2xl border border-border bg-card px-4 py-2">
            <FieldRow
              label="Window"
              value={formatDateRange(page.performance.windowStart, page.performance.windowEnd)}
            />
            <FieldRow label="Total" value={formatMetrics(page.performance.total)} />
            <FieldRow label="Last 7 days" value={formatMetrics(page.performance.last7)} />
            <FieldRow label="Previous 7 days" value={formatMetrics(page.performance.previous7)} />
            <FieldRow
              label="Baseline"
              value={
                page.baseline
                  ? formatMetrics(page.baseline)
                  : "None recorded (zero baseline is explicit)"
              }
            />
          </View>

          <SectionTitle>{`Daily series · last ${VISIBLE_SERIES_DAYS} days`}</SectionTitle>
          {page.performance.days.length === 0 ? (
            <Text className="text-sm text-foreground-muted">No daily data in this window.</Text>
          ) : (
            <View className="rounded-2xl border border-border bg-card px-4 py-2">
              {/* .reverse() on the slice() copy, not .toReversed(): Hermes
                  doesn't ship the ES2023 method. */}
              {page.performance.days
                .slice(-VISIBLE_SERIES_DAYS)
                .reverse()
                .map((day) => (
                  <FieldRow key={day.date} label={day.date} value={formatMetrics(day)} />
                ))}
            </View>
          )}

          <SectionTitle>Top queries</SectionTitle>
          {page.topQueries.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No stored query rows for this page.
            </Text>
          ) : (
            page.topQueries.map((row, index) => (
              <View
                key={`${row.query}:${index}`}
                className="rounded-2xl border border-border bg-card px-4 py-2"
              >
                <Text className="text-sm font-t3-bold text-foreground" selectable>
                  {row.query}
                </Text>
                <FieldRow
                  label="Context"
                  value={`${row.brand ? "Brand" : "Non-brand"} · ${row.mapped ? "planned keyword" : "unplanned"}`}
                />
                <FieldRow label="Current" value={formatMetrics(row.current)} />
                {row.previous ? (
                  <FieldRow label="Previous" value={formatMetrics(row.previous)} />
                ) : null}
              </View>
            ))
          )}

          <SectionTitle>Signals</SectionTitle>
          {page.signals.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No opportunity signals for this page.
            </Text>
          ) : (
            page.signals.map((signal, index) => (
              <View
                key={`${signal.kind}:${index}`}
                className="rounded-2xl border border-border bg-card px-4 py-2"
              >
                <FieldRow label="Kind" value={signal.kind} />
                {signal.query ? <FieldRow label="Query" value={signal.query} /> : null}
                <FieldRow label="Current" value={formatMetrics(signal.current)} />
                <FieldRow label="Recommendation" value={signal.recommendation} />
              </View>
            ))
          )}

          <SectionTitle>Logged actions</SectionTitle>
          {page.actions.length === 0 ? (
            <Text className="text-sm text-foreground-muted">No Actions logged for this page.</Text>
          ) : (
            page.actions.map((entry, index) => (
              <View
                key={`${entry.date}:${index}`}
                className="rounded-2xl border border-border bg-card px-4 py-2"
              >
                <FieldRow label={entry.date} value={entry.kind} />
                {entry.note ? (
                  <Text className="text-sm text-foreground-muted" selectable>
                    {entry.note}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
