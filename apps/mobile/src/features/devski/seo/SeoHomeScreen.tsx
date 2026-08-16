import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { NativeHeaderToolbar } from "../../../native/StackHeader";
import { useSeoClient, useSeoRead } from "./seo-api";
import { readDevskiCacheEntry, writeDevskiCacheEntry } from "../devski-read-cache";
import {
  formatShortDate,
  recentDays,
  OVERVIEW_HISTORY_DAYS,
  OVERVIEW_LOG_ENTRIES,
} from "./seo-overview";
import {
  displayableEnvelope,
  formatCount,
  formatPosition,
  resolveSelectedSite,
  summarizeSeoError,
  type SeoHistoryDay,
  type SeoLogEntry,
  type SeoSite,
  type SeoStackParamList,
} from "./seo-state";
import { SeoImpressionChart } from "./SeoImpressionChart";
import { SeoSectionHeader, SeoStaleNote } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

type SitesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly sites: readonly SeoSite[] };

const SITES_CACHE_KEY = "seo:sites";

/** The daily table's columns, in the order the overview reads them. */
function DailyRow(props: {
  readonly cells: readonly [string, string, string, string];
  readonly muted?: boolean;
}) {
  const tone = props.muted ? "text-foreground-muted" : "text-foreground";
  return (
    <View className="flex-row items-center py-1">
      <Text className={`flex-[1.4] text-sm ${tone}`}>{props.cells[0]}</Text>
      <Text className={`flex-1 text-right text-sm ${tone}`}>{props.cells[1]}</Text>
      <Text className={`flex-1 text-right text-sm ${tone}`}>{props.cells[2]}</Text>
      <Text className={`flex-1 text-right text-sm ${tone}`}>{props.cells[3]}</Text>
    </View>
  );
}

function DailyTable(props: { readonly days: readonly SeoHistoryDay[] }) {
  return (
    <View>
      <DailyRow cells={["date", "impr.", "clicks", "pos."]} muted />
      {props.days.map((day) => (
        <DailyRow
          key={day.date}
          // A provisional day is still being revised by Google; it is shown
          // rather than hidden, and dimmed rather than silently equal.
          muted={day.provisional}
          cells={[
            formatShortDate(day.date),
            formatCount(day.impressions),
            formatCount(day.clicks),
            formatPosition(day.position),
          ]}
        />
      ))}
    </View>
  );
}

function LogRow(props: { readonly entry: SeoLogEntry; readonly onPress: () => void }) {
  const { entry } = props;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="py-2 active:opacity-70"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm text-foreground-muted">{formatShortDate(entry.date)}</Text>
        <Text className="flex-1 text-right text-sm text-foreground" numberOfLines={1}>
          {entry.path}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={3}>
        {entry.note ? `${entry.kind} · ${entry.note}` : entry.kind}
      </Text>
    </Pressable>
  );
}

/**
 * SEO home: the selected Site, its impression trend over the overview
 * window, the most recent daily totals, and the newest Log entries. Each
 * section links to the screen that holds all of it. Read-only — there is no
 * Sync action anywhere in this Area.
 */
export function SeoHomeScreen() {
  const navigation = useNavigation<NavigationProp<SeoStackParamList>>();
  const client = useSeoClient();
  const { selectedSiteId, ready: preferenceReady, select } = useSeoSitePreference();
  // The Site list is what the switcher is made of, so it hydrates too:
  // returning to this Area should not empty the menu for a round trip.
  const [sitesState, setSitesState] = useState<SitesState>(() => {
    const cached = readDevskiCacheEntry<readonly SeoSite[]>(SITES_CACHE_KEY);
    return cached === null ? { kind: "loading" } : { kind: "ready", sites: cached };
  });
  const [refreshing, setRefreshing] = useState(false);

  const loadSites = useCallback(async () => {
    if (!client) return;
    const result = await client.sites();
    if (result.kind === "ok") {
      writeDevskiCacheEntry(SITES_CACHE_KEY, result.value);
      setSitesState({ kind: "ready", sites: result.value });
    } else setSitesState({ kind: "error", message: summarizeSeoError(result) });
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void loadSites();
    }, [loadSites]),
  );

  const sites = sitesState.kind === "ready" ? sitesState.sites : [];
  const selectedSite = resolveSelectedSite(selectedSiteId ?? undefined, sites);

  // First install: make the resolved default visible and persist it, so
  // every other SEO screen reads the same selection.
  useEffect(() => {
    if (preferenceReady && selectedSite && selectedSite.id !== selectedSiteId) {
      select(selectedSite.id);
    }
  }, [preferenceReady, selectedSite, selectedSiteId, select]);

  const siteId = selectedSite?.id ?? null;
  const historyFetcher = useMemo(
    () => (client && siteId ? () => client.history(siteId, OVERVIEW_HISTORY_DAYS) : null),
    [client, siteId],
  );
  const logFetcher = useMemo(
    () => (client && siteId ? () => client.log(siteId) : null),
    [client, siteId],
  );
  const history = useSeoRead(
    siteId ? `history:${siteId}:${OVERVIEW_HISTORY_DAYS}` : null,
    historyFetcher,
  );
  const log = useSeoRead(siteId ? `log:${siteId}` : null, logFetcher);

  if (!client) {
    return (
      <View className="flex-1 bg-screen">
        <EmptyState
          variant="plain"
          title="Pair this device"
          detail="Pair this device in Code to read Ranksta's SEO data."
        />
      </View>
    );
  }

  const historyEnvelope = displayableEnvelope(history.read);
  const logEnvelope = displayableEnvelope(log.read);
  const days = historyEnvelope?.data.days ?? [];
  const actions = logEnvelope?.data.actions ?? [];

  return (
    <>
      {/* The Site selection scopes every SEO screen, so it reads as the
          Area's one navigation-bar control rather than a list of cards.
          The control is the same filter affordance the thread list uses;
          the menu is titled and check-marked for the current Site. */}
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Menu
          accessibilityLabel="Switch Site"
          disabled={sites.length === 0}
          icon="line.3.horizontal.decrease.circle"
          title="Site"
          separateBackground
        >
          {sites.map((site) => (
            <NativeHeaderToolbar.MenuAction
              key={site.id}
              isOn={selectedSite?.id === site.id}
              // The URL wraps to a second line in a menu row and says less
              // than the label does; only its unavailability is news.
              subtitle={site.available ? undefined : "Currently unavailable"}
              onPress={() => select(site.id)}
            >
              <NativeHeaderToolbar.Label>{site.label}</NativeHeaderToolbar.Label>
            </NativeHeaderToolbar.MenuAction>
          ))}
        </NativeHeaderToolbar.Menu>
      </NativeHeaderToolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1 bg-screen"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void Promise.all([loadSites(), history.reload(), log.reload()]).finally(() =>
                setRefreshing(false),
              );
            }}
          />
        }
      >
        {sitesState.kind === "loading" ? (
          <Text className="text-sm text-foreground-muted">Loading configured Sites…</Text>
        ) : null}
        {sitesState.kind === "error" ? <ErrorBanner message={sitesState.message} /> : null}
        {sitesState.kind === "ready" && sites.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No Sites are configured.</Text>
        ) : null}

        {selectedSite ? (
          <>
            <View>
              <Text className="font-t3-bold text-3xl text-foreground">{selectedSite.label}</Text>
              <Text className="mt-0.5 text-base text-foreground-muted">{selectedSite.url}</Text>
            </View>
            <SeoStaleNote read={history.read} />
            <SeoImpressionChart days={days} loading={history.read.kind === "loading"} />

            <SeoSectionHeader
              title="Daily overview"
              actionLabel="see more"
              onPress={() => navigation.navigate("SeoHistory")}
            />
            {days.length === 0 ? (
              <Text className="text-sm text-foreground-muted">
                No daily totals yet for this Site.
              </Text>
            ) : (
              <DailyTable days={recentDays(days)} />
            )}

            <SeoSectionHeader
              title="Log"
              actionLabel="see more"
              onPress={() => navigation.navigate("SeoLog")}
            />
            <SeoStaleNote read={log.read} />
            {actions.length === 0 ? (
              <Text className="text-sm text-foreground-muted">No Actions or Notes logged yet.</Text>
            ) : (
              actions
                .slice(0, OVERVIEW_LOG_ENTRIES)
                .map((entry, index) => (
                  <LogRow
                    key={`${entry.date}:${entry.path}:${entry.kind}:${entry.id ?? index}`}
                    entry={entry}
                    onPress={() => navigation.navigate("SeoPage", { path: entry.path })}
                  />
                ))
            )}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
