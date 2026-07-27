import * as Equal from "effect/Equal";
import {
  formatDuration,
  workEntryIndicatesToolFailure,
  workEntryIndicatesToolNeutralStatus,
  workLogEntryIsToolLike,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { type MessageId, type OrchestrationLatestTurn, type TurnId } from "@t3tools/contracts";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;
/** Phase A: one live summary pill + tool count on settled folds. Flip to revert. */
export const CHAT_TOOL_ACTIVITY_PHASE_A = true;
/** Phase B: hide live tool pills from the timeline; surface latest tool in the composer. */
export const CHAT_TOOL_ACTIVITY_PHASE_B = true;
/** Phase C: expandable activity drawer for live + settled tool lists. */
export const CHAT_TOOL_ACTIVITY_PHASE_C = true;
export const TIMELINE_MINIMAP_ITEM_SPACING = 8;
export const TIMELINE_MINIMAP_MIN_ITEMS = 2;
export const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)";
export const TIMELINE_CONTENT_MAX_WIDTH = 768;
export const TIMELINE_MINIMAP_PERSISTENT_GUTTER = 48;

export interface TimelineEndState {
  readonly isAtEnd?: boolean;
  readonly isNearEnd?: boolean;
}

export function resolveTimelineIsAtEnd(state: TimelineEndState | undefined): boolean | undefined {
  return state?.isNearEnd ?? state?.isAtEnd;
}

export function resolveTimelineMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`;
}

export function resolveTimelineMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) {
    return 0;
  }
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

export function resolveTimelineMinimapIndexFromPointer(input: {
  readonly itemCount: number;
  readonly railTop: number;
  readonly railHeight: number;
  readonly pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null;
  }
  if (input.itemCount === 1) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))));
}

export function resolveTimelineMinimapHasPersistentGutter(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return sideGutter >= TIMELINE_MINIMAP_PERSISTENT_GUTTER;
}

export const TIMELINE_MINIMAP_HIT_STRIP_LEFT = 12;
export const TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH = 40;
export const TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH = "22rem";

/**
 * The minimap overlays the viewport's left edge while the content column is
 * centered, so the side gutter between them shrinks under browser zoom or a
 * narrow pane. A fixed-width hover strip would then sit on top of the message
 * text and swallow its pointer events. Cap the strip's width so it never
 * extends past the gutter into the content column; 0 disables the strip.
 */
export function resolveTimelineMinimapHitStripWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 0;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return Math.max(
    0,
    Math.min(
      TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH,
      Math.floor(sideGutter) - TIMELINE_MINIMAP_HIT_STRIP_LEFT,
    ),
  );
}

/**
 * Once the preview is open, keep the full preview and the space leading to it
 * interactive. The collapsed strip remains gutter-capped so it cannot block
 * selecting message text.
 */
export function resolveTimelineMinimapInteractiveWidth(
  collapsedWidth: number,
  expanded: boolean,
): number | string {
  return expanded ? TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH : collapsedWidth;
}

function computeElapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
}

export type TimelineLatestTurn = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "work-toggle";
      id: string;
      createdAt: string;
      groupId: string;
      hiddenCount: number;
      expanded: boolean;
      onlyToolEntries: boolean;
    }
  | {
      kind: "work-live-summary";
      id: string;
      createdAt: string;
      latestEntry: WorkLogEntry;
      entries: ReadonlyArray<WorkLogEntry>;
      totalCount: number;
    }
  | {
      kind: "turn-fold";
      id: string;
      createdAt: string;
      turnId: TurnId;
      label: string;
      expanded: boolean;
      toolEntries: ReadonlyArray<WorkLogEntry>;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showAssistantMeta: boolean;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
      assistantTurnFold?: EmbeddedAssistantTurnFold | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export type EmbeddedTurnContentItem =
  | {
      kind: "assistant-segment";
      id: string;
      text: string;
    }
  | {
      kind: "work";
      id: string;
      entry: WorkLogEntry;
    };

export type EmbeddedAssistantTurnFold = {
  turnId: TurnId;
  label: string;
  expanded: boolean;
  toolEntries: ReadonlyArray<WorkLogEntry>;
  /** Chat layout v2: render tool rows under the summary line inside the assistant message. */
  showEmbeddedToolEntries: boolean;
  /** Chat layout v2: render the full unfolded turn under the assistant header. */
  showEmbeddedFullTurn: boolean;
  embeddedTurnItems: ReadonlyArray<EmbeddedTurnContentItem>;
};

export function buildEmbeddedTurnContentItems(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyArray<EmbeddedTurnContentItem> {
  const items: EmbeddedTurnContentItem[] = [];

  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "assistant") {
      const text = entry.message.text?.trim();
      if (!text) {
        continue;
      }
      items.push({
        kind: "assistant-segment",
        id: entry.id,
        text: entry.message.text ?? "",
      });
      continue;
    }

    if (entry.kind === "work") {
      items.push({
        kind: "work",
        id: entry.id,
        entry: entry.entry,
      });
    }
  }

  return items;
}

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && !message.streaming) {
      lastBoundary = message.updatedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function capitalizePhrase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatWorkLogEntryHeading(
  entry: Pick<WorkLogEntry, "label" | "toolTitle">,
): string {
  if (!entry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(entry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(entry.toolTitle));
}

export type ToolActivityLineIcon = "link" | "edit" | "terminal" | "globe" | "eye";

type WorkEntryActivityCategory = "file-edit" | "file-read" | "command" | "web-search" | "custom";

function categorizeWorkEntryActivity(entry: WorkLogEntry): {
  category: WorkEntryActivityCategory;
  customPhrase?: string;
} {
  if (
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0
  ) {
    return { category: "file-edit" };
  }
  if (entry.requestKind === "file-read" || entry.itemType === "image_view") {
    return { category: "file-read" };
  }
  if (
    entry.requestKind === "command" ||
    entry.itemType === "command_execution" ||
    (entry.command?.trim().length ?? 0) > 0
  ) {
    return { category: "command" };
  }
  if (entry.itemType === "web_search") {
    return { category: "web-search" };
  }

  const heading = formatWorkLogEntryHeading(entry);
  return {
    category: "custom",
    customPhrase: heading.charAt(0).toLowerCase() + heading.slice(1),
  };
}

export function formatToolActivitySummary(entries: ReadonlyArray<WorkLogEntry>): string {
  if (entries.length === 0) {
    return "";
  }

  let fileEdits = 0;
  let fileReads = 0;
  let commands = 0;
  let webSearches = 0;
  const customPhrases: string[] = [];
  const seenCustom = new Set<string>();

  for (const entry of entries) {
    const { category, customPhrase } = categorizeWorkEntryActivity(entry);
    switch (category) {
      case "file-edit":
        fileEdits += 1;
        break;
      case "file-read":
        fileReads += 1;
        break;
      case "command":
        commands += 1;
        break;
      case "web-search":
        webSearches += 1;
        break;
      case "custom":
        if (customPhrase && !seenCustom.has(customPhrase)) {
          seenCustom.add(customPhrase);
          customPhrases.push(customPhrase);
        }
        break;
    }
  }

  const parts: string[] = [...customPhrases];
  if (fileReads > 0) {
    parts.push(fileReads === 1 ? "read a file" : "read files");
  }
  if (fileEdits > 0) {
    parts.push(fileEdits === 1 ? "edited a file" : "edited files");
  }
  if (commands > 0) {
    parts.push(commands === 1 ? "ran a command" : "ran commands");
  }
  if (webSearches > 0) {
    parts.push("searched the web");
  }

  if (parts.length === 0) {
    return "";
  }

  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function resolveToolActivityEntryIcon(entry: WorkLogEntry): ToolActivityLineIcon {
  const { category } = categorizeWorkEntryActivity(entry);
  switch (category) {
    case "file-edit":
      return "edit";
    case "file-read":
      return "eye";
    case "command":
      return "terminal";
    case "web-search":
      return "globe";
    case "custom":
    default:
      return "link";
  }
}

export function resolveToolActivitySummaryIcon(
  entries: ReadonlyArray<WorkLogEntry>,
): ToolActivityLineIcon {
  if (
    entries.some(
      (entry) =>
        entry.requestKind === "file-change" ||
        entry.itemType === "file_change" ||
        (entry.changedFiles?.length ?? 0) > 0,
    )
  ) {
    return "edit";
  }
  if (
    entries.some(
      (entry) =>
        entry.requestKind === "command" ||
        entry.itemType === "command_execution" ||
        (entry.command?.trim().length ?? 0) > 0,
    )
  ) {
    return "terminal";
  }
  if (entries.some((entry) => entry.itemType === "web_search")) {
    return "globe";
  }
  if (
    entries.some((entry) => entry.requestKind === "file-read" || entry.itemType === "image_view")
  ) {
    return "eye";
  }
  return "link";
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

interface TurnFold {
  turnId: TurnId;
  anchorEntryId: string;
  createdAt: string;
  hiddenEntryIds: ReadonlySet<string>;
  hiddenWorkEntryIds: ReadonlySet<string>;
  hiddenEntriesInOrder: ReadonlyArray<TimelineEntry>;
  label: string;
  toolEntries: ReadonlyArray<WorkLogEntry>;
}

export interface LiveTurnToolActivity {
  latestEntry: WorkLogEntry;
  entries: ReadonlyArray<WorkLogEntry>;
  totalCount: number;
}

/**
 * The session's running turn is authoritative when latestTurn briefly lags or
 * regresses behind it. Otherwise, the latest turn counts as unsettled while it
 * is still running (or has not recorded a completion). This is deliberately
 * keyed on turn lifecycle rather than transient working state: right after the
 * user sends a message, the previous turn is still the "active" one until the
 * server creates the new turn, and folding must not flicker through that window.
 */
function deriveUnsettledTurnId(
  latestTurn: TimelineLatestTurn | null,
  runningTurnId: TurnId | null,
): TurnId | null {
  if (runningTurnId !== null) {
    return runningTurnId;
  }
  if (!latestTurn) {
    return null;
  }
  const isSettled = latestTurn.completedAt !== null && latestTurn.state !== "running";
  return isSettled ? null : latestTurn.turnId;
}

/**
 * Settled turns fold their commentary and tool activity behind a
 * "Worked for ..." row anchored at the turn's first foldable entry; the
 * terminal assistant message stays visible below the fold.
 */
interface LiveWorkSummary {
  anchorTimelineEntryId: string;
  latestEntry: WorkLogEntry;
  entries: ReadonlyArray<WorkLogEntry>;
  totalCount: number;
  suppressedTimelineEntryIds: ReadonlySet<string>;
}

function collectTurnToolEntries(
  entries: ReadonlyArray<TimelineEntry>,
  hiddenEntryIds: ReadonlySet<string>,
): WorkLogEntry[] {
  const toolEntries: WorkLogEntry[] = [];
  for (const entry of entries) {
    if (!hiddenEntryIds.has(entry.id) || entry.kind !== "work") {
      continue;
    }
    if (workEntryIndicatesToolNeutralStatus(entry.entry)) {
      continue;
    }
    if (!workLogEntryIsToolLike(entry.entry)) {
      continue;
    }
    toolEntries.push(entry.entry);
  }
  return toolEntries;
}

export function deriveLiveTurnToolActivity(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn?: TimelineLatestTurn | null;
  runningTurnId?: TurnId | null;
}): LiveTurnToolActivity | null {
  const unsettledTurnId = deriveUnsettledTurnId(
    input.latestTurn ?? null,
    input.runningTurnId ?? null,
  );
  const summary = deriveLiveWorkSummary({
    timelineEntries: input.timelineEntries,
    unsettledTurnId,
    compactLiveToolActivity: true,
  });
  if (!summary) {
    return null;
  }
  return {
    latestEntry: summary.latestEntry,
    entries: summary.entries,
    totalCount: summary.totalCount,
  };
}

function deriveLiveWorkSummary(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  unsettledTurnId: TurnId | null;
  compactLiveToolActivity: boolean;
}): LiveWorkSummary | null {
  if (!input.compactLiveToolActivity || input.unsettledTurnId === null) {
    return null;
  }

  const collapsibleEntries: Array<{ timelineId: string; entry: WorkLogEntry }> = [];
  for (const timelineEntry of input.timelineEntries) {
    if (timelineEntry.kind !== "work") {
      continue;
    }
    if (timelineEntry.entry.turnId !== input.unsettledTurnId) {
      continue;
    }
    if (workEntryIndicatesToolNeutralStatus(timelineEntry.entry)) {
      continue;
    }
    if (workEntryIndicatesToolFailure(timelineEntry.entry)) {
      continue;
    }
    collapsibleEntries.push({ timelineId: timelineEntry.id, entry: timelineEntry.entry });
  }

  const latest = collapsibleEntries.at(-1);
  if (!latest) {
    return null;
  }

  const suppressedTimelineEntryIds = new Set<string>();
  for (const entry of collapsibleEntries) {
    if (entry.timelineId !== latest.timelineId) {
      suppressedTimelineEntryIds.add(entry.timelineId);
    }
  }

  return {
    anchorTimelineEntryId: latest.timelineId,
    latestEntry: latest.entry,
    entries: collapsibleEntries.map((entry) => entry.entry),
    totalCount: collapsibleEntries.length,
    suppressedTimelineEntryIds,
  };
}

function countHiddenToolEntries(
  entries: ReadonlyArray<TimelineEntry>,
  hiddenEntryIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const entry of entries) {
    if (!hiddenEntryIds.has(entry.id) || entry.kind !== "work") {
      continue;
    }
    if (workEntryIndicatesToolNeutralStatus(entry.entry)) {
      continue;
    }
    if (!workLogEntryIsToolLike(entry.entry)) {
      continue;
    }
    count += 1;
  }
  return count;
}

function formatTurnFoldLabel(input: {
  duration: string | null;
  isLatestInterruptedTurn: boolean;
  toolCount: number;
  includeToolCount: boolean;
}): string {
  const toolSuffix =
    input.includeToolCount && input.toolCount > 0
      ? ` · ${input.toolCount} ${input.toolCount === 1 ? "tool" : "tools"}`
      : "";

  if (input.isLatestInterruptedTurn) {
    return input.duration
      ? `You stopped after ${input.duration}${toolSuffix}`
      : `You stopped this response${toolSuffix}`;
  }

  return input.duration ? `Worked for ${input.duration}${toolSuffix}` : `Worked${toolSuffix}`;
}

function deriveTurnFolds(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  terminalAssistantMessageIds: ReadonlySet<string>;
  latestTurn: TimelineLatestTurn | null;
  unsettledTurnId: TurnId | null;
  compactLiveToolActivity: boolean;
}): ReadonlyMap<string, TurnFold> {
  interface TurnGroup {
    entries: Array<TimelineEntry>;
    terminalEntry: Extract<TimelineEntry, { kind: "message" }> | null;
    hasStreamingMessage: boolean;
    /**
     * The user message that kicked the turn off. Entry timestamps alone
     * undercount the duration (the first entry appears only once the
     * provider starts producing output), and a turn cut short by a steer may
     * hold a single instantaneous commentary message.
     */
    startBoundary: string | null;
  }
  const groupsByTurnId = new Map<TurnId, TurnGroup>();

  let pendingUserBoundary: string | null = null;
  for (const entry of input.timelineEntries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      pendingUserBoundary = entry.message.createdAt;
      continue;
    }
    const turnId =
      entry.kind === "message" && entry.message.role === "assistant"
        ? (entry.message.turnId ?? null)
        : entry.kind === "work"
          ? (entry.entry.turnId ?? null)
          : null;
    if (!turnId) {
      continue;
    }
    let group = groupsByTurnId.get(turnId);
    if (!group) {
      group = {
        entries: [],
        terminalEntry: null,
        hasStreamingMessage: false,
        // Each user boundary starts at most one turn; a second turn after the
        // same user message (e.g. a steer-superseded continuation) falls back
        // to its own first entry.
        startBoundary: pendingUserBoundary,
      };
      pendingUserBoundary = null;
      groupsByTurnId.set(turnId, group);
    }
    group.entries.push(entry);
    if (entry.kind === "message") {
      if (input.terminalAssistantMessageIds.has(entry.message.id)) {
        group.terminalEntry = entry;
      }
      if (entry.message.streaming) {
        group.hasStreamingMessage = true;
      }
    }
  }

  const foldsByAnchorEntryId = new Map<string, TurnFold>();
  for (const [turnId, group] of groupsByTurnId) {
    if (turnId === input.unsettledTurnId) {
      continue;
    }
    if (group.hasStreamingMessage) {
      continue;
    }
    const hiddenEntryIds = new Set<string>();
    const hiddenWorkEntryIds = new Set<string>();
    for (const entry of group.entries) {
      if (entry.id !== group.terminalEntry?.id) {
        hiddenEntryIds.add(entry.id);
        if (entry.kind === "work") {
          hiddenWorkEntryIds.add(entry.id);
        }
      }
    }
    if (hiddenEntryIds.size === 0) {
      continue;
    }

    const firstEntry = group.entries[0];
    const lastEntry = group.entries.at(-1);
    if (!firstEntry || !lastEntry) {
      continue;
    }

    const isLatestInterruptedTurn =
      input.latestTurn?.turnId === turnId && input.latestTurn.state === "interrupted";
    // A turn cut short by a steer leaves trailing work entries behind its
    // terminal message — take whichever ended last.
    const lastEntryEnd =
      lastEntry.kind === "message" ? lastEntry.message.updatedAt : lastEntry.createdAt;
    const elapsedMs =
      input.latestTurn?.turnId === turnId &&
      input.latestTurn.startedAt &&
      input.latestTurn.completedAt
        ? computeElapsedMs(input.latestTurn.startedAt, input.latestTurn.completedAt)
        : computeElapsedMs(
            group.startBoundary ?? firstEntry.createdAt,
            maxIsoTimestamp(group.terminalEntry?.message.updatedAt ?? null, lastEntryEnd) ??
              lastEntryEnd,
          );
    const duration = elapsedMs !== null ? formatDuration(elapsedMs) : null;
    const toolCount = countHiddenToolEntries(group.entries, hiddenEntryIds);
    const label = formatTurnFoldLabel({
      duration,
      isLatestInterruptedTurn,
      toolCount,
      includeToolCount: input.compactLiveToolActivity,
    });
    const toolEntries = collectTurnToolEntries(group.entries, hiddenEntryIds);
    const terminalEntry = group.terminalEntry;
    if (!terminalEntry) {
      continue;
    }
    const hiddenEntriesInOrder = group.entries.filter((entry) => entry.id !== terminalEntry.id);

    foldsByAnchorEntryId.set(terminalEntry.id, {
      turnId,
      anchorEntryId: terminalEntry.id,
      createdAt: terminalEntry.createdAt,
      hiddenEntryIds,
      hiddenWorkEntryIds,
      hiddenEntriesInOrder,
      label,
      toolEntries,
    });
  }
  return foldsByAnchorEntryId;
}

export function deriveFoldableTurnIds(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn?: TimelineLatestTurn | null;
  runningTurnId?: TurnId | null;
}): ReadonlySet<TurnId> {
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);
  const unsettledTurnId = deriveUnsettledTurnId(
    input.latestTurn ?? null,
    input.runningTurnId ?? null,
  );
  const foldsByAnchorEntryId = deriveTurnFolds({
    timelineEntries: input.timelineEntries,
    terminalAssistantMessageIds,
    latestTurn: input.latestTurn ?? null,
    unsettledTurnId,
    compactLiveToolActivity: false,
  });

  return new Set([...foldsByAnchorEntryId.values()].map((fold) => fold.turnId));
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn?: TimelineLatestTurn | null;
  runningTurnId?: TurnId | null;
  expandedTurnIds?: ReadonlySet<TurnId>;
  /** Chat layout v2: reveal hidden tool rows inline without unfolding commentary. */
  expandedTurnActivityIds?: ReadonlySet<TurnId>;
  activityOnlyExpand?: boolean;
  expandedWorkGroupIds?: ReadonlySet<string>;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  /** When true, the working indicator lives in the composer instead of the timeline. */
  hideWorkingIndicator?: boolean;
  /** Phase A: collapse live-turn tools into one summary pill; append tool count to fold labels. */
  compactLiveToolActivity?: boolean;
  /** Phase B: keep live-turn tools out of the timeline (composer carries them instead). */
  quietLiveToolActivity?: boolean;
  /** Chat layout v2: render turn fold under the assistant header instead of a separate row. */
  embedAssistantTurnFold?: boolean;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const compactLiveToolActivity = input.compactLiveToolActivity ?? false;
  const quietLiveToolActivity = input.quietLiveToolActivity ?? false;
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);
  const unsettledTurnId = deriveUnsettledTurnId(
    input.latestTurn ?? null,
    input.runningTurnId ?? null,
  );
  const foldsByAnchorEntryId = deriveTurnFolds({
    timelineEntries: input.timelineEntries,
    terminalAssistantMessageIds,
    latestTurn: input.latestTurn ?? null,
    unsettledTurnId,
    compactLiveToolActivity,
  });
  const liveWorkSummary = deriveLiveWorkSummary({
    timelineEntries: input.timelineEntries,
    unsettledTurnId,
    compactLiveToolActivity,
  });
  const collapsedEntryIds = new Set<string>();
  for (const fold of foldsByAnchorEntryId.values()) {
    const fullExpanded = input.expandedTurnIds?.has(fold.turnId) ?? false;
    const activityExpanded = input.expandedTurnActivityIds?.has(fold.turnId) ?? false;

    if (fullExpanded) {
      if (input.embedAssistantTurnFold) {
        for (const entryId of fold.hiddenEntryIds) {
          collapsedEntryIds.add(entryId);
        }
      }
      continue;
    }

    if (activityExpanded && input.activityOnlyExpand) {
      const embedToolsInAssistant = input.embedAssistantTurnFold === true;
      for (const entryId of fold.hiddenEntryIds) {
        if (!fold.hiddenWorkEntryIds.has(entryId)) {
          collapsedEntryIds.add(entryId);
        } else if (embedToolsInAssistant) {
          collapsedEntryIds.add(entryId);
        }
      }
      continue;
    }

    if (!activityExpanded) {
      for (const entryId of fold.hiddenEntryIds) {
        collapsedEntryIds.add(entryId);
      }
    }
  }

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    const turnFold = foldsByAnchorEntryId.get(timelineEntry.id);
    const fullTurnExpanded =
      turnFold !== undefined && (input.expandedTurnIds?.has(turnFold.turnId) ?? false);
    const activityTurnExpanded =
      turnFold !== undefined && (input.expandedTurnActivityIds?.has(turnFold.turnId) ?? false);
    const turnFoldExpanded = fullTurnExpanded || activityTurnExpanded;
    const embeddedTurnItems =
      input.embedAssistantTurnFold === true && fullTurnExpanded
        ? buildEmbeddedTurnContentItems(turnFold?.hiddenEntriesInOrder ?? [])
        : [];
    const embeddedTurnFold: EmbeddedAssistantTurnFold | undefined =
      turnFold !== undefined
        ? {
            turnId: turnFold.turnId,
            label: turnFold.label,
            expanded: turnFoldExpanded,
            toolEntries: turnFold.toolEntries,
            showEmbeddedToolEntries:
              input.embedAssistantTurnFold === true &&
              input.activityOnlyExpand === true &&
              activityTurnExpanded &&
              !fullTurnExpanded &&
              turnFold.toolEntries.length > 0,
            showEmbeddedFullTurn:
              input.embedAssistantTurnFold === true &&
              fullTurnExpanded &&
              embeddedTurnItems.length > 0,
            embeddedTurnItems,
          }
        : undefined;

    if (turnFold && !input.embedAssistantTurnFold) {
      nextRows.push({
        kind: "turn-fold",
        id: `turn-fold:${turnFold.turnId}`,
        createdAt: turnFold.createdAt,
        turnId: turnFold.turnId,
        label: turnFold.label,
        expanded: turnFoldExpanded,
        toolEntries: turnFold.toolEntries,
      });
    }

    if (collapsedEntryIds.has(timelineEntry.id)) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const isUnsettledTurnWork =
        unsettledTurnId !== null && timelineEntry.entry.turnId === unsettledTurnId;

      if (compactLiveToolActivity && isUnsettledTurnWork) {
        if (liveWorkSummary?.suppressedTimelineEntryIds.has(timelineEntry.id)) {
          continue;
        }

        if (
          !quietLiveToolActivity &&
          liveWorkSummary &&
          timelineEntry.id === liveWorkSummary.anchorTimelineEntryId &&
          !workEntryIndicatesToolFailure(timelineEntry.entry) &&
          !workEntryIndicatesToolNeutralStatus(timelineEntry.entry)
        ) {
          nextRows.push({
            kind: "work-live-summary",
            id: timelineEntry.id,
            createdAt: timelineEntry.createdAt,
            latestEntry: liveWorkSummary.latestEntry,
            entries: liveWorkSummary.entries,
            totalCount: liveWorkSummary.totalCount,
          });
          continue;
        }

        if (
          !workEntryIndicatesToolNeutralStatus(timelineEntry.entry) &&
          workEntryIndicatesToolFailure(timelineEntry.entry)
        ) {
          nextRows.push({
            kind: "work",
            id: timelineEntry.id,
            createdAt: timelineEntry.createdAt,
            groupedEntries: [timelineEntry.entry],
          });
        }
        continue;
      }

      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (
          !nextEntry ||
          nextEntry.kind !== "work" ||
          collapsedEntryIds.has(nextEntry.id) ||
          foldsByAnchorEntryId.has(nextEntry.id)
        ) {
          break;
        }
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      const visibleGroupedEntries = groupedEntries.filter(
        (entry) => !workEntryIndicatesToolNeutralStatus(entry),
      );
      if (visibleGroupedEntries.length > 0) {
        if (visibleGroupedEntries.length <= MAX_VISIBLE_WORK_LOG_ENTRIES) {
          nextRows.push({
            kind: "work",
            id: timelineEntry.id,
            createdAt: timelineEntry.createdAt,
            groupedEntries: visibleGroupedEntries,
          });
        } else {
          const groupId = `work-group:${timelineEntry.id}`;
          const expanded = input.expandedWorkGroupIds?.has(groupId) ?? false;
          const hiddenEntries = visibleGroupedEntries.slice(0, -MAX_VISIBLE_WORK_LOG_ENTRIES);
          const visibleEntries = visibleGroupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES);
          const renderedEntries = expanded ? [...hiddenEntries, ...visibleEntries] : visibleEntries;

          for (const workEntry of renderedEntries) {
            nextRows.push({
              kind: "work",
              id: workEntry.id,
              createdAt: workEntry.createdAt,
              groupedEntries: [workEntry],
            });
          }

          nextRows.push({
            kind: "work-toggle",
            id: `work-toggle:${timelineEntry.id}`,
            createdAt: timelineEntry.createdAt,
            groupId,
            hiddenCount: hiddenEntries.length,
            expanded,
            onlyToolEntries: visibleGroupedEntries.every((entry) => workLogEntryIsToolLike(entry)),
          });
        }
      }
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      unsettledTurnId !== null &&
      timelineEntry.message.turnId === unsettledTurnId;

    const durationStart =
      durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt;

    // While the turn is still running, the latest assistant message is only
    // provisionally terminal — withhold the metadata row until the turn
    // settles so commentary doesn't flash timestamps mid-work.
    const showAssistantMeta =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id) &&
      !assistantTurnStillInProgress;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart,
      showAssistantMeta,
      showAssistantCopyButton: showAssistantMeta,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
      assistantTurnFold:
        input.embedAssistantTurnFold &&
        timelineEntry.message.role === "assistant" &&
        embeddedTurnFold !== undefined
          ? embeddedTurnFold
          : undefined,
    });
  }

  if (input.isWorking && !input.hideWorkingIndicator) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

/** Discord-style clustering: consecutive messages from the same speaker share one header. */
export function deriveChatMessageGroupStartIds(
  rows: ReadonlyArray<MessagesTimelineRow>,
): ReadonlySet<string> {
  const startIds = new Set<string>();
  let currentSpeaker: "user" | "assistant" | null = null;

  for (const row of rows) {
    if (row.kind !== "message") {
      continue;
    }
    const role = row.message.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    if (role !== currentSpeaker) {
      startIds.add(String(row.message.id));
      currentSpeaker = role;
    }
  }

  return startIds;
}

export type ChatLayoutV2RowRhythm = {
  readonly pb: string;
  readonly pt: string | null;
};

function messageRowRole(row: MessagesTimelineRow): "user" | "assistant" | null {
  if (row.kind !== "message") {
    return null;
  }
  return row.message.role === "user" || row.message.role === "assistant" ? row.message.role : null;
}

function isChatActivityRow(row: MessagesTimelineRow | undefined): boolean {
  return (
    row?.kind === "work" ||
    row?.kind === "work-live-summary" ||
    row?.kind === "work-toggle" ||
    row?.kind === "turn-fold"
  );
}

/** Context-aware vertical rhythm for chat layout v2 (Slack-style tight intra-speaker gaps). */
export function deriveChatLayoutV2RowRhythm(
  rows: ReadonlyArray<MessagesTimelineRow>,
  groupStartIds: ReadonlySet<string>,
): ReadonlyMap<string, ChatLayoutV2RowRhythm> {
  const rhythm = new Map<string, ChatLayoutV2RowRhythm>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }
    const next = rows[index + 1];
    const role = messageRowRole(row);
    const nextRole = next ? messageRowRole(next) : null;
    const groupStart = row.kind === "message" && groupStartIds.has(String(row.message.id));

    let pb = "pb-1";
    const pt: string | null = null;

    switch (row.kind) {
      case "message": {
        if (next?.kind === "message") {
          pb = nextRole !== role ? "pb-2" : "pb-0";
        } else if (isChatActivityRow(next)) {
          pb = "pb-1";
        } else {
          pb = "pb-2";
        }
        break;
      }
      case "work":
      case "work-live-summary":
      case "work-toggle":
        if (
          next?.kind === "work" ||
          next?.kind === "work-live-summary" ||
          next?.kind === "work-toggle"
        ) {
          pb = "pb-0.5";
        } else if (next?.kind === "message") {
          pb = "pb-1";
        } else {
          pb = "pb-1";
        }
        break;
      case "turn-fold":
        pb = next?.kind === "message" || isChatActivityRow(next) ? "pb-1" : "pb-1.5";
        break;
      case "working":
        pb = "pb-1";
        break;
      case "proposed-plan":
      default:
        pb = "pb-1";
        break;
    }

    rhythm.set(row.id, { pb, pt: groupStart ? pt : null });
  }

  return rhythm;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "turn-fold": {
      const bf = b as typeof a;
      return (
        a.createdAt === bf.createdAt &&
        a.label === bf.label &&
        a.expanded === bf.expanded &&
        Equal.equals(a.toolEntries, bf.toolEntries)
      );
    }

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return Equal.equals(a.groupedEntries, (b as typeof a).groupedEntries);

    case "work-live-summary": {
      const bl = b as typeof a;
      return (
        a.createdAt === bl.createdAt &&
        a.totalCount === bl.totalCount &&
        Equal.equals(a.latestEntry, bl.latestEntry) &&
        Equal.equals(a.entries, bl.entries)
      );
    }

    case "work-toggle": {
      const bw = b as typeof a;
      return (
        a.createdAt === bw.createdAt &&
        a.groupId === bw.groupId &&
        a.hiddenCount === bw.hiddenCount &&
        a.expanded === bw.expanded &&
        a.onlyToolEntries === bw.onlyToolEntries
      );
    }

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount &&
        Equal.equals(a.assistantTurnFold, bm.assistantTurnFold)
      );
    }
  }
}
