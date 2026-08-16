import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { ChoiceRow, FieldRow, ListRow, SectionTitle } from "../automations/AutomationsUi";
import { useSeoClient, useSeoRead } from "./seo-api";
import {
  describeIndexState,
  displayableEnvelope,
  formatCount,
  formatDateRange,
  indexCoverage,
  pagesNeedingAttention,
  resolveSelectedSite,
  summarizeSeoError,
  trueTotalsFromHistory,
  verdictSummary,
  type SeoSite,
  type SeoStackParamList,
} from "./seo-state";
import { SeoFreshnessBanner } from "./SeoUi";
import { useSeoSitePreference } from "./use-seo-site";

type SitesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly sites: readonly SeoSite[] };

const SECTION_LINKS: ReadonlyArray<{
  readonly screen: keyof Omit<SeoStackParamList, "SeoPage" | "SeoHome">;
  readonly title: string;
  readonly detail: string;
}> = [
  {
    screen: "SeoOpportunities",
    title: "Opportunities",
    detail: "Striking-distance, CTR, new-demand, and cannibalization signals.",
  },
  {
    screen: "SeoHistory",
    title: "History",
    detail: "Daily true clicks, impressions, CTR, and position.",
  },
  {
    screen: "SeoRegistry",
    title: "Registry",
    detail: "Target pages, keyword plan, phase, and index state.",
  },
  { screen: "SeoLog", title: "Log", detail: "Newest-first Action and Note history." },
  {
    screen: "SeoQueries",
    title: "Queries",
    detail: "Top queries with page, brand, and mapping context.",
  },
];

/**
 * SEO home: the visible persisted Site selector, freshness, true site
 * totals, per-page verdict summary, indexing coverage, and pages needing
 * attention. Read-only — there is no Sync action anywhere in this Area.
 */
export function SeoHomeScreen() {
  const navigation = useNavigation<NavigationProp<SeoStackParamList>>();
  const client = useSeoClient();
  const { selectedSiteId, ready: preferenceReady, select } = useSeoSitePreference();
  const [sitesState, setSitesState] = useState<SitesState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const loadSites = useCallback(async () => {
    if (!client) return;
    const result = await client.sites();
    if (result.kind === "ok") setSitesState({ kind: "ready", sites: result.value });
    else setSitesState({ kind: "error", message: summarizeSeoError(result) });
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
  const statusFetcher = useMemo(
    () => (client && siteId ? () => client.status(siteId) : null),
    [client, siteId],
  );
  const pagesFetcher = useMemo(
    () => (client && siteId ? () => client.pages(siteId) : null),
    [client, siteId],
  );
  const historyFetcher = useMemo(
    () => (client && siteId ? () => client.history(siteId, 28) : null),
    [client, siteId],
  );
  const status = useSeoRead(statusFetcher);
  const pages = useSeoRead(pagesFetcher);
  const history = useSeoRead(historyFetcher);

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

  const statusEnvelope = displayableEnvelope(status.read);
  const pagesEnvelope = displayableEnvelope(pages.read);
  const historyEnvelope = displayableEnvelope(history.read);
  const attention = pagesEnvelope ? pagesNeedingAttention(pagesEnvelope.data.pages) : [];
  const totals = historyEnvelope ? trueTotalsFromHistory(historyEnvelope.data.days) : null;
  const coverage = pagesEnvelope ? indexCoverage(pagesEnvelope.data.pages) : null;

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
            void Promise.all([
              loadSites(),
              status.reload(),
              pages.reload(),
              history.reload(),
            ]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <SectionTitle>Site</SectionTitle>
      {sitesState.kind === "loading" ? (
        <Text className="text-sm text-foreground-muted">Loading configured Sites…</Text>
      ) : null}
      {sitesState.kind === "error" ? <ErrorBanner message={sitesState.message} /> : null}
      {sites.map((site) => (
        <ChoiceRow
          key={site.id}
          label={site.label}
          detail={site.available ? site.url : `${site.url} · currently unavailable`}
          selected={selectedSite?.id === site.id}
          onPress={() => select(site.id)}
        />
      ))}
      {sitesState.kind === "ready" && sites.length === 0 ? (
        <Text className="text-sm text-foreground-muted">No Sites are configured.</Text>
      ) : null}

      {selectedSite ? (
        <>
          <SectionTitle>Freshness</SectionTitle>
          <SeoFreshnessBanner read={status.read} />
          {statusEnvelope ? (
            <View className="rounded-2xl border border-border bg-card px-4 py-2">
              <FieldRow
                label="Data range"
                value={formatDateRange(
                  statusEnvelope.data.data.firstDate,
                  statusEnvelope.data.data.lastDate,
                )}
              />
              <FieldRow
                label="Synced days"
                value={formatCount(statusEnvelope.data.data.syncedDays)}
              />
              <FieldRow
                label="Registry"
                value={`${statusEnvelope.data.registry.targets} targets · ${statusEnvelope.data.registry.keywords} keywords · ${statusEnvelope.data.registry.clusters} clusters`}
              />
              <FieldRow
                label="Sitemap"
                value={`${statusEnvelope.data.sitemap.pages} pages · ${statusEnvelope.data.sitemap.unmapped.length} unmapped`}
              />
              <FieldRow label="Actions logged" value={formatCount(statusEnvelope.data.actions)} />
            </View>
          ) : null}

          <SectionTitle>True site totals</SectionTitle>
          {totals ? (
            totals.days === 0 ? (
              <Text className="text-sm text-foreground-muted">
                No daily totals yet for this Site.
              </Text>
            ) : (
              <View className="rounded-2xl border border-border bg-card px-4 py-2">
                <FieldRow
                  label={`Clicks (${totals.days} days)`}
                  value={formatCount(totals.clicks)}
                />
                <FieldRow
                  label={`Impressions (${totals.days} days)`}
                  value={formatCount(totals.impressions)}
                />
              </View>
            )
          ) : (
            <SeoFreshnessBanner read={history.read} />
          )}

          <SectionTitle>Verdicts</SectionTitle>
          {pagesEnvelope ? (
            pagesEnvelope.data.pages.length === 0 ? (
              <Text className="text-sm text-foreground-muted">No measured pages yet.</Text>
            ) : (
              <View className="rounded-2xl border border-border bg-card px-4 py-2">
                {verdictSummary(pagesEnvelope.data.pages).map((entry) => (
                  <FieldRow
                    key={entry.verdict}
                    label={entry.verdict}
                    value={formatCount(entry.count)}
                  />
                ))}
              </View>
            )
          ) : (
            <SeoFreshnessBanner read={pages.read} />
          )}

          <SectionTitle>Index coverage</SectionTitle>
          {coverage ? (
            <View className="rounded-2xl border border-border bg-card px-4 py-2">
              <FieldRow label="Indexed" value={formatCount(coverage.indexed)} />
              <FieldRow label="Not indexed" value={formatCount(coverage.notIndexed)} />
              <FieldRow label="Unknown" value={formatCount(coverage.unknown)} />
            </View>
          ) : null}

          <SectionTitle>Needs attention</SectionTitle>
          {pagesEnvelope ? (
            attention.length === 0 ? (
              <Text className="text-sm text-foreground-muted">
                No page needs attention right now.
              </Text>
            ) : (
              attention.map((page) => (
                <ListRow
                  key={page.path}
                  title={page.path}
                  lines={[
                    `${page.verdict} · ${describeIndexState(page.indexed, null)}`,
                    ...page.reasons.slice(0, 2),
                  ]}
                  onPress={() => navigation.navigate("SeoPage", { path: page.path })}
                />
              ))
            )
          ) : null}

          <SectionTitle>Views</SectionTitle>
          {SECTION_LINKS.map((link) => (
            <ListRow
              key={link.screen}
              title={link.title}
              lines={[link.detail]}
              onPress={() => navigation.navigate(link.screen)}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
