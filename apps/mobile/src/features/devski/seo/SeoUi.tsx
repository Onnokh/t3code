import { useEffect, useRef } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import {
  describeFreshness,
  displayState,
  displayableEnvelope,
  type SeoRead,
  type SeoSite,
} from "./seo-state";

export function siteIndexForOffset(offset: number, pageWidth: number, siteCount: number): number {
  if (siteCount === 0 || pageWidth <= 0) return 0;
  return Math.min(siteCount - 1, Math.max(0, Math.round(offset / pageWidth)));
}

/**
 * A native-feeling horizontal Site pager. The menu remains available for
 * precise selection, while a short swipe moves the shared persisted Site
 * selection used by every SEO screen.
 */
export function SeoSitePager(props: {
  readonly sites: readonly SeoSite[];
  readonly selectedSiteId: string | null;
  readonly onSelect: (siteId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const pageWidth = Math.max(1, width - 40);
  const scrollRef = useRef<ScrollView>(null);
  const selectedIndex = Math.max(
    0,
    props.sites.findIndex((site) => site.id === props.selectedSiteId),
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: selectedIndex * pageWidth, animated: false });
  }, [pageWidth, selectedIndex]);

  if (props.sites.length === 0) return null;

  return (
    <View className="gap-1">
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        directionalLockEnabled
        decelerationRate="fast"
        scrollEventThrottle={16}
        style={{ width: pageWidth }}
        accessibilityLabel="SEO projects"
        onMomentumScrollEnd={(event) => {
          const index = siteIndexForOffset(
            event.nativeEvent.contentOffset.x,
            pageWidth,
            props.sites.length,
          );
          const site = props.sites[index];
          if (site && site.id !== props.selectedSiteId) props.onSelect(site.id);
        }}
      >
        {props.sites.map((site) => (
          <View key={site.id} style={{ width: pageWidth }} className="pr-2">
            <View className="rounded-2xl border border-border bg-card px-4 py-3">
              <Text className="text-xs text-foreground-muted">Swipe to switch project</Text>
              <Text className="font-t3-bold text-lg text-foreground" selectable>
                {site.label}
              </Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={1} selectable>
                {site.url}
              </Text>
              {!site.available ? (
                <Text className="mt-1 text-xs text-foreground-muted">Currently unavailable</Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>
      {props.sites.length > 1 ? (
        <Text className="text-center text-xs text-foreground-muted">
          {`${selectedIndex + 1} of ${props.sites.length} projects`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Deliberately plain shared pieces for the SEO Area. PLO-416 ships a
 * functional read-only surface with existing T3 primitives only; a designed
 * UI is a separate owner-in-the-loop ticket. The list/row/button/choice
 * primitives are shared with the Automations Area.
 */

/**
 * The visible data state every SEO screen shows: current, stale (Gateway-
 * marked or retained after a failed revalidation), or unavailable. Renders
 * nothing while loading with nothing to say.
 */
export function SeoFreshnessBanner(props: {
  readonly read: SeoRead<unknown>;
  readonly message?: string;
}) {
  const state = displayState(props.read);
  if (state === "loading") {
    return <Text className="text-sm text-foreground-muted">Loading…</Text>;
  }
  if (state === "pairing-required") return null;
  if (state === "unavailable") {
    return (
      <View className="rounded-2xl border border-border bg-card px-4 py-3">
        <Text className="text-sm font-t3-bold text-foreground">SEO data unavailable</Text>
        <Text className="mt-0.5 text-sm text-foreground-muted">
          {props.message ?? "The SEO service did not answer. Pull to retry the read."}
        </Text>
      </View>
    );
  }
  const envelope = displayableEnvelope(props.read);
  if (!envelope) return null;
  return (
    <View className="rounded-2xl border border-border bg-card px-4 py-3">
      <Text className="text-sm font-t3-bold text-foreground">
        {state === "stale" ? "Stale data" : "Current"}
        {` · ${envelope.site.label}`}
      </Text>
      <Text className="mt-0.5 text-xs text-foreground-muted">
        {describeFreshness(envelope.freshness)}
      </Text>
      {state === "stale" && props.read.kind === "unavailable" ? (
        <Text className="mt-0.5 text-xs text-foreground-muted">
          Showing the last successful read; the latest refresh failed.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The overview's one-line version of the banner: silent while the data is
 * current, so the screen stays as plain as the design asks, and explicit
 * the moment what it shows is no longer the latest read.
 */
export function SeoStaleNote(props: { readonly read: SeoRead<unknown> }) {
  const state = displayState(props.read);
  if (state !== "stale" && state !== "unavailable") return null;
  if (state === "unavailable") {
    return (
      <Text className="text-xs text-foreground-muted">
        SEO data is unavailable. Pull down to retry the read.
      </Text>
    );
  }
  const envelope = displayableEnvelope(props.read);
  const retained = props.read.kind === "unavailable";
  return (
    <Text className="text-xs text-foreground-muted">
      {retained ? "Last successful read · " : ""}
      {envelope ? describeFreshness(envelope.freshness) : "Stale data"}
    </Text>
  );
}

/** A section title beside the link to the screen that holds all of it. */
export function SeoSectionHeader(props: {
  readonly title: string;
  readonly actionLabel: string;
  readonly onPress: () => void;
}) {
  return (
    <View className="mt-4 flex-row items-center justify-between gap-3">
      <Text className="font-t3-bold text-xl text-foreground">{props.title}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={props.onPress}
        className="rounded-xl border border-border bg-card px-3 py-1.5 active:opacity-70"
      >
        <Text className="text-sm text-foreground">{props.actionLabel}</Text>
      </Pressable>
    </View>
  );
}
