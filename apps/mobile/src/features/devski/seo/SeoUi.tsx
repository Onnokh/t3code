import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import {
  describeCoverage,
  displayState,
  displayableEnvelope,
  type SeoFreshness,
  type SeoRead,
} from "./seo-state";

/**
 * Deliberately plain shared pieces for the SEO Area. PLO-416 ships a
 * functional read-only surface with existing T3 primitives only; a designed
 * UI is a separate owner-in-the-loop ticket. The list/row/button/choice
 * primitives are shared with the Automations Area.
 */

/**
 * The visible data state every SEO screen shows: current, unconfirmed (drawn
 * from what this device stored at an earlier launch), stale (Gateway-marked
 * or retained after a failed revalidation), or unavailable. Renders nothing
 * while loading with nothing to say.
 *
 * Which read produced the payload is the whole of what it reports. It used to
 * add the payload's own date range underneath, and does not any more: the data
 * date sits one line above it now, and the same dates twice, a line apart, is
 * an invitation to read one of them as something it is not. The three screens
 * whose comparison window genuinely differs from the Site's data date print
 * that window beside the numbers it belongs to, where it can be understood.
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
        {state === "stale"
          ? "Stale data"
          : state === "unconfirmed"
            ? "Not confirmed yet"
            : "Current"}
        {` · ${envelope.site.label}`}
      </Text>
      {state === "unconfirmed" ? (
        <Text className="mt-0.5 text-xs text-foreground-muted">
          Saved on this device by an earlier read. A live read is on its way.
        </Text>
      ) : null}
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
 *
 * Like the banner, it says which read the payload came from and leaves the
 * dates to the data date line above it. Repeating a range here was worse than
 * in the banner, because this note only appears when something is off, and a
 * date range in the one line that means "trouble" reads as though the range
 * were the trouble.
 */
export function SeoStaleNote(props: { readonly read: SeoRead<unknown> }) {
  const state = displayState(props.read);
  if (state === "unconfirmed") {
    return (
      <Text className="text-xs text-foreground-muted">
        Saved on this device by an earlier read. A live read is on its way.
      </Text>
    );
  }
  if (state !== "stale" && state !== "unavailable") return null;
  if (state === "unavailable") {
    return (
      <Text className="text-xs text-foreground-muted">
        SEO data is unavailable. Pull down to retry the read.
      </Text>
    );
  }
  return (
    <Text className="text-xs text-foreground-muted">
      {props.read.kind === "unavailable"
        ? "Showing the last successful read; the latest refresh failed."
        : "Stale data from the SEO service."}
    </Text>
  );
}

/**
 * The date this Site's data reaches, and how recently Ranksta looked for more.
 * Every SEO screen shows it, and it is what a pull to refresh shows for itself.
 *
 * It replaces a relative "last synced" age. The age was the wrong instrument:
 * it is recalculated against the clock on every render, so it moves whether or
 * not anything happened, and it stood still through refreshes that had worked
 * because the instant behind it only moves when the data changes. A date and a
 * check answer the two questions the owner actually asked — how current is
 * this, and did my pull do anything — and neither can be true by accident.
 *
 * Always rendered, an unknown date included: a line that disappears leaves a
 * gap where a date belongs, and a gap reads as "there has never been any data"
 * when the truth is only that this device has not been told the date yet. It
 * sits apart from the freshness banner on purpose — that banner is about which
 * read produced the payload, this is about the data behind it, and one is
 * regularly true while the other is not.
 */
export function SeoDataDate(props: { readonly freshness: SeoFreshness | null }) {
  return <Text className="text-xs text-foreground-muted">{describeCoverage(props.freshness)}</Text>;
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
