import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ChoiceRow, ListRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead } from "./seo-api";
import {
  displayableEnvelope,
  formatDateRange,
  formatMetrics,
  PARTIAL_VISIBILITY_NOTE,
  type SeoQueryRow,
  type SeoStackParamList,
} from "./seo-state";
import { SeoFreshnessBanner } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

const QUERY_LIMIT = 100;

function pathOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

function queryLines(row: SeoQueryRow): string[] {
  const lines = [pathOf(row.page), formatMetrics(row.current)];
  if (row.previous) lines.push(`Previous: ${formatMetrics(row.previous)}`);
  lines.push(
    `${row.brand ? "Brand query" : "Non-brand query"} · ${row.mappedTarget ? `mapped to ${row.mappedTarget}` : "not mapped to a keyword target"}`,
  );
  return lines;
}

/**
 * Top observed queries with page, brand, and registry-mapping context.
 * Query-derived rows are explicitly partial keyword visibility.
 */
export function SeoQueriesScreen() {
  const navigation = useNavigation<NavigationProp<SeoStackParamList>>();
  const client = useSeoClient();
  const { selectedSiteId } = useSeoSitePreference();
  const [includeBrand, setIncludeBrand] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useMemo(
    () =>
      client && selectedSiteId
        ? () => client.queries(selectedSiteId, { includeBrand, limit: QUERY_LIMIT })
        : null,
    [client, selectedSiteId, includeBrand],
  );
  const { read, reload } = useSeoRead(fetcher);
  const envelope = displayableEnvelope(read);

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
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void reload().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <SeoFreshnessBanner read={read} />
      <Text className="text-xs text-foreground-muted">{PARTIAL_VISIBILITY_NOTE}</Text>
      <SectionTitle>Brand</SectionTitle>
      <ChoiceRow
        label="Non-brand only"
        selected={!includeBrand}
        onPress={() => setIncludeBrand(false)}
      />
      <ChoiceRow
        label="Include brand queries"
        selected={includeBrand}
        onPress={() => setIncludeBrand(true)}
      />
      {envelope ? (
        <>
          <SectionTitle>{`Queries · ${formatDateRange(envelope.data.window.currentStart, envelope.data.window.currentEnd)}`}</SectionTitle>
          {envelope.data.queries.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No stored query rows in this window.
            </Text>
          ) : (
            envelope.data.queries.map((row, index) => (
              <ListRow
                key={`${row.query}:${row.page}:${index}`}
                title={row.query}
                lines={queryLines(row)}
                onPress={() => navigation.navigate("SeoPage", { path: pathOf(row.page) })}
              />
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
