import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { type StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { FieldRow, SectionTitle } from "../automations/AutomationsUi";
import { readDevskiCacheEntry, writeDevskiCacheEntry } from "../devski-read-cache";
import { useSeoClient, useSeoRead, useSeoRefresh } from "./seo-api";
import {
  describeIndexState,
  displayableEnvelope,
  formatDateRange,
  formatMetrics,
  formatWindow,
  PARTIAL_VISIBILITY_NOTE,
  resolveSelectedSite,
  type SeoSite,
} from "./seo-state";
import { SeoDataDate, SeoFreshnessBanner } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

type Params = { readonly path: string };

const VISIBLE_SERIES_DAYS = 14;
const SITES_CACHE_KEY = "seo:sites";

/**
 * Full report for one canonical page path: plan, rationale, verdict
 * reasons, index state, daily series, top queries, baseline, signals, and
 * logged actions — all as Ranksta returned them.
 */
export function SeoPageDetailScreen({ route }: StaticScreenProps<Params>) {
  const { path } = route.params;
  const client = useSeoClient();
  const { selectedSiteId, select } = useSeoSitePreference();
  const [sites, setSites] = useState<readonly SeoSite[]>(
    () => readDevskiCacheEntry<readonly SeoSite[]>(SITES_CACHE_KEY) ?? [],
  );
  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.sites().then((result) => {
      if (!active || result.kind !== "ok") return;
      writeDevskiCacheEntry(SITES_CACHE_KEY, result.value);
      setSites(result.value);
    });
    return () => {
      active = false;
    };
  }, [client]);

  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<SeoSite>>(null);
  const selectedSite = resolveSelectedSite(selectedSiteId ?? undefined, sites);
  const selectedId = selectedSite?.id ?? selectedSiteId;
  const selectedIndex = Math.max(
    0,
    sites.findIndex((site) => site.id === selectedId),
  );

  useEffect(() => {
    if (sites.length === 0) return;
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
  }, [selectedIndex, sites.length]);

  if (!client || !selectedId) {
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

  if (sites.length === 0) {
    return <SeoPageDetailSite client={client} path={path} siteId={selectedId} width={width} />;
  }

  return (
    <FlatList
      ref={listRef}
      data={sites}
      horizontal
      pagingEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="never"
      keyExtractor={(site) => site.id}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      initialScrollIndex={selectedIndex}
      onScrollToIndexFailed={({ index }) => {
        setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 0);
      }}
      onMomentumScrollEnd={(event) => {
        const pageWidth = Math.max(1, event.nativeEvent.layoutMeasurement.width);
        const index = Math.min(
          sites.length - 1,
          Math.max(0, Math.round(event.nativeEvent.contentOffset.x / pageWidth)),
        );
        const site = sites[index];
        if (site && site.id !== selectedId) select(site.id);
      }}
      renderItem={({ item }) => (
        <SeoPageDetailSite client={client} path={path} siteId={item.id} width={width} />
      )}
    />
  );
}

function SeoPageDetailSite(props: {
  readonly client: NonNullable<ReturnType<typeof useSeoClient>>;
  readonly path: string;
  readonly siteId: string;
  readonly width: number;
}) {
  const fetcher = useMemo(
    () => () => props.client.page(props.siteId, props.path),
    [props.client, props.path, props.siteId],
  );
  const { read, reload } = useSeoRead(`page:${props.siteId}:${props.path}`, fetcher);
  const refresh = useSeoRefresh(props.client, props.siteId, reload);
  const envelope = displayableEnvelope(read);
  const page = envelope?.data ?? null;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ width: props.width }}
      className="flex-1 bg-screen"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 20 }}
      refreshControl={
        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.refresh} />
      }
    >
      <Text className="font-t3-bold text-foreground" selectable>
        {props.path}
      </Text>
      <SeoDataDate freshness={refresh.freshness} />
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
