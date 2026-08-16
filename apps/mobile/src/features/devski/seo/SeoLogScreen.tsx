import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ListRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead } from "./seo-api";
import { displayableEnvelope, type SeoStackParamList } from "./seo-state";
import { SeoFreshnessBanner } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

/**
 * The newest-first Action and Note history, exactly as Ranksta returns it.
 * Visualization only: log_add is not part of the mobile contract.
 */
export function SeoLogScreen() {
  const navigation = useNavigation<NavigationProp<SeoStackParamList>>();
  const client = useSeoClient();
  const { selectedSiteId } = useSeoSitePreference();
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useMemo(
    () => (client && selectedSiteId ? () => client.log(selectedSiteId) : null),
    [client, selectedSiteId],
  );
  const { read, reload } = useSeoRead(selectedSiteId ? `log:${selectedSiteId}` : null, fetcher);
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
      {envelope ? (
        <>
          <SectionTitle>{`Log · ${envelope.data.actions.length} entries`}</SectionTitle>
          {envelope.data.actions.length === 0 ? (
            <Text className="text-sm text-foreground-muted">No Actions or Notes logged yet.</Text>
          ) : (
            envelope.data.actions.map((entry, index) => (
              <ListRow
                key={`${entry.date}:${entry.path}:${entry.kind}:${entry.id ?? index}`}
                title={`${entry.date} · ${entry.kind}`}
                lines={[entry.path, ...(entry.note ? [entry.note] : [])]}
                onPress={() => navigation.navigate("SeoPage", { path: entry.path })}
              />
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
