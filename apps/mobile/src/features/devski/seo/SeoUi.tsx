import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import {
  describeCoverage,
  describeSyncOutcome,
  describeSyncedAt,
  displayState,
  displayableEnvelope,
  type SeoRead,
  type SeoSyncOutcome,
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
      <Text className="mt-0.5 text-xs text-foreground-muted">
        {describeCoverage(envelope.freshness)}
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
  const envelope = displayableEnvelope(props.read);
  const retained = props.read.kind === "unavailable";
  return (
    <Text className="text-xs text-foreground-muted">
      {retained ? "Last successful read · " : ""}
      {envelope ? describeCoverage(envelope.freshness) : "Stale data"}
    </Text>
  );
}

/**
 * When this Site's Search Console data last arrived, and what this device's
 * last sync request came to.
 *
 * Two facts, one line, because apart they invite exactly the wrong reading.
 * The arrival time moves only when Ranksta fetches a day it had not fetched
 * recently, so it holds still through a refresh that worked perfectly; on its
 * own it looks like a dead gesture. The request's outcome is what says the
 * gesture landed — and, when the Gateway refused, that it did not.
 *
 * The time is always rendered, an unknown one included: a line that disappears
 * leaves a gap where a time belongs, and a gap reads as "nothing has ever
 * synced" when the Gateway only meant it did not ask. The outcome is appended
 * only once there is one, since before the first pull there is nothing to
 * report. Both sit apart from the freshness banner on purpose — that banner is
 * about which read produced the payload, these are about the data behind it and
 * the gesture that asked for more.
 */
export function SeoSyncedTime(props: {
  readonly syncedAt: string | null;
  readonly sync?: SeoSyncOutcome;
}) {
  const outcome = props.sync ? describeSyncOutcome(props.sync) : null;
  return (
    <Text className="text-xs text-foreground-muted">
      {describeSyncedAt(props.syncedAt)}
      {outcome === null ? "" : ` · ${outcome}`}
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
