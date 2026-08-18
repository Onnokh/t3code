import { useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { FieldRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead, useSeoRefresh } from "./seo-api";
import { displayableEnvelope, formatCount, formatCtr, formatPosition } from "./seo-state";
import { SeoFreshnessBanner, SeoSyncedTime } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

const HISTORY_DAYS = 56;

/**
 * Daily true site totals, newest last as Ranksta returns them. Provisional
 * days (still being revised by Google) are labeled instead of hidden.
 */
export function SeoHistoryScreen() {
  const client = useSeoClient();
  const { selectedSiteId } = useSeoSitePreference();

  const fetcher = useMemo(
    () => (client && selectedSiteId ? () => client.history(selectedSiteId, HISTORY_DAYS) : null),
    [client, selectedSiteId],
  );
  const { read, reload } = useSeoRead(
    selectedSiteId ? `history:${selectedSiteId}:${HISTORY_DAYS}` : null,
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
      {envelope ? (
        <>
          <SectionTitle>{`Daily true totals · last ${HISTORY_DAYS} days`}</SectionTitle>
          {envelope.data.days.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No daily totals yet for this Site.
            </Text>
          ) : (
            <View className="rounded-2xl border border-border bg-card px-4 py-2">
              {/* .reverse() on a copy, not .toReversed(): Hermes doesn't ship
                  the ES2023 method. */}
              {[...envelope.data.days].reverse().map((day) => (
                <FieldRow
                  key={day.date}
                  label={day.provisional ? `${day.date} (provisional)` : day.date}
                  value={`${formatCount(day.clicks)} clicks · ${formatCount(day.impressions)} impr · ${formatCtr(day.ctr)} · pos ${formatPosition(day.position)}`}
                />
              ))}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
