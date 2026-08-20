import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { NativeHeaderToolbar } from "../../../native/StackHeader";
import { useSeoClient, useSeoRead, useSeoRefresh } from "./seo-api";
import { useDevskiCacheEntry, writeDevskiCacheEntry } from "../devski-read-cache";
import {
  formatShortDate,
  recentDays,
  registryRow,
  OVERVIEW_HISTORY_DAYS,
  OVERVIEW_LOG_ENTRIES,
  OVERVIEW_REGISTRY_ROWS,
  type RegistryRow,
} from "./seo-overview";
import {
  displayableEnvelope,
  formatCount,
  formatPosition,
  resolveSelectedSite,
  summarizeSeoError,
  type SeoHistoryDay,
  type SeoLogEntry,
  type SeoRegistryTarget,
  type SeoSite,
  type SeoStackParamList,
} from "./seo-state";
import { SeoDailyChart } from "./SeoDailyChart";
import { SeoDataDate, SeoSectionHeader, SeoStaleNote } from "./SeoUi";
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

/**
 * One Registry line, in the same table grammar as the daily rows: the
 * label on the left, its numbers on the right. A long target keeps both
 * ends and loses its middle, which is where paths repeat themselves.
 */
function RegistryRowLine(props: {
  readonly cells: RegistryRow;
  readonly muted?: boolean;
  readonly onPress?: () => void;
}) {
  const tone = props.muted ? "text-foreground-muted" : "text-foreground";
  const line = (
    <View className="flex-row items-center py-1">
      <Text className={`w-7 text-sm ${tone}`}>{props.cells[0]}</Text>
      <Text className={`flex-[2] text-sm ${tone}`} numberOfLines={1} ellipsizeMode="middle">
        {props.cells[1]}
      </Text>
      <Text className={`flex-1 text-right text-sm ${tone}`}>{props.cells[2]}</Text>
      <Text className={`flex-1 text-right text-sm ${tone}`}>{props.cells[3]}</Text>
    </View>
  );
  if (!props.onPress) return line;
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} className="active:opacity-70">
      {line}
    </Pressable>
  );
}

function RegistryTable(props: {
  readonly targets: readonly SeoRegistryTarget[];
  readonly onSelect: (path: string) => void;
}) {
  return (
    <View>
      <RegistryRowLine cells={["pr", "target", "impr.", "phase"]} muted />
      {props.targets.map((target) => (
        <RegistryRowLine
          key={target.targetUrl}
          cells={registryRow(target)}
          onPress={() => props.onSelect(target.targetUrl)}
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
  const cachedSites = useDevskiCacheEntry<readonly SeoSite[]>(SITES_CACHE_KEY);
  const [loadedSites, setLoadedSites] = useState<SitesState | null>(null);
  const sitesState: SitesState =
    loadedSites ??
    (cachedSites === null ? { kind: "loading" } : { kind: "ready", sites: cachedSites.value });

  const loadSites = useCallback(async () => {
    if (!client) return;
    const result = await client.sites();
    if (result.kind === "ok") {
      writeDevskiCacheEntry(SITES_CACHE_KEY, result.value);
      setLoadedSites({ kind: "ready", sites: result.value });
    } else setLoadedSites({ kind: "error", message: summarizeSeoError(result) });
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

  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<SeoSite>>(null);
  const selectedIndex = Math.max(
    0,
    sites.findIndex((site) => site.id === selectedSite?.id),
  );

  useEffect(() => {
    if (sites.length === 0) return;
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
  }, [selectedIndex, sites.length]);

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
      {sitesState.kind === "error" ? <ErrorBanner message={sitesState.message} /> : null}
      {sites.length === 0 ? (
        <View className="flex-1 bg-screen px-5 pt-5">
          <Text className="text-sm text-foreground-muted">
            {sitesState.kind === "loading"
              ? "Loading configured Sites…"
              : "No Sites are configured."}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={sites}
          horizontal
          pagingEnabled
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
            if (site && site.id !== selectedSite?.id) select(site.id);
          }}
          renderItem={({ item }) => (
            <SeoHomeSitePage
              client={client}
              site={item}
              width={width}
              navigation={navigation}
              onRefreshSites={loadSites}
            />
          )}
        />
      )}
    </>
  );
}

function SeoHomeSitePage(props: {
  readonly client: NonNullable<ReturnType<typeof useSeoClient>>;
  readonly site: SeoSite;
  readonly width: number;
  readonly navigation: NavigationProp<SeoStackParamList>;
  readonly onRefreshSites: () => Promise<void>;
}) {
  const historyFetcher = useMemo(
    () => () => props.client.history(props.site.id, OVERVIEW_HISTORY_DAYS),
    [props.client, props.site.id],
  );
  const logFetcher = useMemo(
    () => () => props.client.log(props.site.id),
    [props.client, props.site.id],
  );
  const registryFetcher = useMemo(
    () => () => props.client.registry(props.site.id),
    [props.client, props.site.id],
  );
  const history = useSeoRead(`history:${props.site.id}:${OVERVIEW_HISTORY_DAYS}`, historyFetcher);
  const log = useSeoRead(`log:${props.site.id}`, logFetcher);
  const registry = useSeoRead(`registry:${props.site.id}`, registryFetcher);
  const refresh = useSeoRefresh(props.client, props.site.id, () =>
    Promise.all([props.onRefreshSites(), history.reload(), log.reload(), registry.reload()]),
  );
  const historyEnvelope = displayableEnvelope(history.read);
  const logEnvelope = displayableEnvelope(log.read);
  const registryEnvelope = displayableEnvelope(registry.read);
  const days = historyEnvelope?.data.days ?? [];
  const actions = logEnvelope?.data.actions ?? [];
  const targets = registryEnvelope?.data.targets ?? [];

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
      <View>
        <Text className="font-t3-bold text-3xl text-foreground">{props.site.label}</Text>
        <Text className="mt-0.5 text-base text-foreground-muted">{props.site.url}</Text>
      </View>
      <SeoDataDate freshness={refresh.freshness} />
      <SeoStaleNote read={history.read} />
      <SeoDailyChart days={days} loading={history.read.kind === "loading"} />

      <SeoSectionHeader
        title="Daily overview"
        actionLabel="see more"
        onPress={() => props.navigation.navigate("SeoHistory")}
      />
      {days.length === 0 ? (
        <Text className="text-sm text-foreground-muted">No daily totals yet for this Site.</Text>
      ) : (
        <DailyTable days={recentDays(days)} />
      )}

      <SeoSectionHeader
        title="Log"
        actionLabel="see more"
        onPress={() => props.navigation.navigate("SeoLog")}
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
              onPress={() => props.navigation.navigate("SeoPage", { path: entry.path })}
            />
          ))
      )}

      <SeoSectionHeader
        title="Registry"
        actionLabel="see more"
        onPress={() => props.navigation.navigate("SeoRegistry")}
      />
      <SeoStaleNote read={registry.read} />
      {targets.length === 0 ? (
        <Text className="text-sm text-foreground-muted">The Registry has no targets yet.</Text>
      ) : (
        <RegistryTable
          targets={targets.slice(0, OVERVIEW_REGISTRY_ROWS)}
          onSelect={(path) => props.navigation.navigate("SeoPage", { path })}
        />
      )}
    </ScrollView>
  );
}
