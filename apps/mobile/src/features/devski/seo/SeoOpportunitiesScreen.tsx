import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ChoiceRow, ListRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead, useSeoRefresh } from "./seo-api";
import {
  displayableEnvelope,
  formatDateRange,
  formatMetrics,
  type SeoSignal,
  type SeoStackParamList,
} from "./seo-state";
import { SeoFreshnessBanner, SeoSyncedTime } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

/** Ranksta's four opportunity kinds; classification stays server-side. */
const KIND_FILTERS: ReadonlyArray<{ readonly kind: string | null; readonly label: string }> = [
  { kind: null, label: "All kinds" },
  { kind: "striking-distance", label: "Striking-distance" },
  { kind: "ctr", label: "CTR" },
  { kind: "new-demand", label: "New-demand" },
  { kind: "cannibalization", label: "Cannibalization" },
];

function pathOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

function signalLines(signal: SeoSignal): string[] {
  const lines = [
    signal.pages.length > 1 ? signal.pages.map(pathOf).join(" · ") : pathOf(signal.page),
  ];
  lines.push(formatMetrics(signal.current));
  lines.push(signal.recommendation);
  if (signal.registry) {
    lines.push(
      `Mapped: ${signal.registry.targetUrl} (${signal.registry.priority}, ${signal.registry.intent})`,
    );
  } else if (!signal.mapped) {
    lines.push("Not mapped to a keyword target.");
  }
  return lines;
}

/** Opportunity digest exactly as Ranksta classified it, filterable by kind. */
export function SeoOpportunitiesScreen() {
  const navigation = useNavigation<NavigationProp<SeoStackParamList>>();
  const client = useSeoClient();
  const { selectedSiteId } = useSeoSitePreference();
  const [kind, setKind] = useState<string | null>(null);

  const fetcher = useMemo(
    () =>
      client && selectedSiteId
        ? () => client.opportunities(selectedSiteId, kind ?? undefined)
        : null,
    [client, selectedSiteId, kind],
  );
  const { read, reload } = useSeoRead(
    selectedSiteId ? `opportunities:${selectedSiteId}:${kind ?? "all"}` : null,
    fetcher,
  );
  // Pull to refresh reads live and asks Ranksta to look at Search Console
  // again. It resolves on the read, never on the sync.
  const refresh = useSeoRefresh(client, selectedSiteId, reload);
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
        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.refresh} />
      }
    >
      <SeoSyncedTime syncedAt={refresh.syncedAt} sync={refresh.sync} />
      <SeoFreshnessBanner read={read} />
      <SectionTitle>Kind</SectionTitle>
      {KIND_FILTERS.map((filter) => (
        <ChoiceRow
          key={filter.label}
          label={filter.label}
          selected={kind === filter.kind}
          onPress={() => setKind(filter.kind)}
        />
      ))}
      {envelope ? (
        <>
          <SectionTitle>{`Signals · ${formatDateRange(envelope.data.window.currentStart, envelope.data.window.currentEnd)}`}</SectionTitle>
          {envelope.data.signals.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No opportunity signals in the current window.
            </Text>
          ) : (
            envelope.data.signals.map((signal, index) => (
              <ListRow
                key={`${signal.kind}:${signal.query ?? ""}:${signal.page}:${index}`}
                title={`${signal.kind}${signal.query ? ` · ${signal.query}` : ""}`}
                lines={signalLines(signal)}
                onPress={() => navigation.navigate("SeoPage", { path: pathOf(signal.page) })}
              />
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
