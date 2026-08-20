import { useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ListRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead, useSeoRefresh } from "./seo-api";
import {
  describeIndexState,
  displayableEnvelope,
  formatMetrics,
  type SeoRegistryTarget,
  type SeoStackParamList,
} from "./seo-state";
import { SeoDataDate, SeoFreshnessBanner } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

function targetLines(target: SeoRegistryTarget): string[] {
  const lines = [
    `${target.phase} · ${target.state} · ${describeIndexState(target.indexed, target.inspectedAt)}`,
    `${target.priority ?? "no priority"} · ${target.intent} · ${target.status}`,
  ];
  if (target.keywords.length > 0) {
    lines.push(`Keywords: ${target.keywords.map((keyword) => keyword.keyword).join(", ")}`);
  } else {
    lines.push("Inventory-only page (no keyword target).");
  }
  if (target.publishedAt || target.baselineDate) {
    lines.push(`Published ${target.publishedAt ?? "—"} · baseline ${target.baselineDate ?? "—"}`);
  }
  lines.push(`Window: ${formatMetrics(target.window)}`);
  if (target.baseline) lines.push(`Baseline: ${formatMetrics(target.baseline)}`);
  else lines.push("Baseline: none recorded.");
  if (target.whyOpportunity) lines.push(`Why: ${target.whyOpportunity}`);
  return lines;
}

/**
 * The read-only plan and progress Registry. Visualization only: no
 * registry_add or registry_set exists in the mobile contract.
 */
export function SeoRegistryScreen() {
  const navigation = useNavigation<NavigationProp<SeoStackParamList>>();
  const client = useSeoClient();
  const { selectedSiteId } = useSeoSitePreference();

  const fetcher = useMemo(
    () => (client && selectedSiteId ? () => client.registry(selectedSiteId) : null),
    [client, selectedSiteId],
  );
  const { read, reload } = useSeoRead(
    selectedSiteId ? `registry:${selectedSiteId}` : null,
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
      <SeoDataDate freshness={refresh.freshness} />
      <SeoFreshnessBanner read={read} />
      {envelope ? (
        <>
          <SectionTitle>{`Targets · ${envelope.data.targets.length}`}</SectionTitle>
          {envelope.data.targets.length === 0 ? (
            <Text className="text-sm text-foreground-muted">The Registry has no targets yet.</Text>
          ) : (
            envelope.data.targets.map((target) => (
              <ListRow
                key={target.targetUrl}
                title={target.targetUrl}
                lines={targetLines(target)}
                onPress={() => navigation.navigate("SeoPage", { path: target.targetUrl })}
              />
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
