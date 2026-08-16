/**
 * opencode2Events — pure translation from OpenCode 2 service-contract
 * events to T3's canonical runtime-event vocabulary.
 *
 * The adapter subscribes to the server's global `/api/event` stream and
 * feeds every event whose `data.sessionID` matches one of its sessions
 * through {@link translateOpenCode2Event}. The translator owns the
 * per-session merge state (emitted text per content item, pending
 * permission/question requests, tool names) and returns provider-agnostic
 * "drafts"; the adapter stamps thread/turn/event ids and timestamps.
 *
 * Keeping this pure makes the canonical mapping — the riskiest part of the
 * driver — directly unit-testable against recorded server payloads.
 *
 * @module provider/opencode2Events
 */
import type { Permission, Question } from "@opencode-ai/client/effect";
import type {
  ThreadTokenUsageSnapshot,
  ToolLifecycleItemType,
  UserInputQuestion,
} from "@t3tools/contracts";

import { openCode2QuestionId } from "./opencode2Runtime.ts";

/**
 * Structural view of one event from the global stream. The generated
 * union is enormous; the translator only reads the small envelope plus a
 * per-type `data` payload, so it accepts the structural shape and narrows
 * defensively. Every unknown type falls through to "no events".
 */
export interface OpenCode2StreamEvent {
  readonly id?: string;
  readonly type: string;
  readonly data?: unknown;
  readonly created?: unknown;
  readonly durable?: { readonly seq?: number } | undefined;
}

export type OpenCode2TranslatedEvent =
  | {
      readonly kind: "content.delta";
      readonly itemId: string;
      readonly streamKind: "assistant_text" | "reasoning_text";
      readonly delta: string;
    }
  | {
      readonly kind: "assistant-message.completed";
      readonly itemId: string;
      readonly text: string;
    }
  | {
      readonly kind: "tool.item";
      readonly phase: "started" | "updated" | "completed";
      readonly callId: string;
      readonly itemType: ToolLifecycleItemType;
      readonly status: "inProgress" | "completed" | "failed";
      readonly title?: string;
      readonly detail?: string;
      readonly data?: unknown;
    }
  | { readonly kind: "turn.completed" }
  | { readonly kind: "turn.failed"; readonly message: string }
  | { readonly kind: "turn.interrupted"; readonly reason: string }
  | { readonly kind: "thread.renamed"; readonly title: string }
  | { readonly kind: "token-usage"; readonly usage: ThreadTokenUsageSnapshot }
  | {
      readonly kind: "request.opened";
      readonly requestId: string;
      readonly requestType:
        | "command_execution_approval"
        | "file_read_approval"
        | "file_change_approval"
        | "unknown";
      readonly detail: string;
      readonly args?: unknown;
    }
  | {
      readonly kind: "request.resolved";
      readonly requestId: string;
      readonly decision: string;
    }
  | {
      readonly kind: "user-input.requested";
      readonly requestId: string;
      readonly questions: ReadonlyArray<UserInputQuestion>;
    }
  | {
      readonly kind: "user-input.resolved";
      readonly requestId: string;
      readonly answers: Record<string, unknown>;
    }
  | { readonly kind: "runtime.warning"; readonly message: string; readonly detail?: unknown }
  | { readonly kind: "runtime.error"; readonly message: string; readonly detail?: unknown };

/**
 * Mutable per-session translation state. Owned by the adapter's session
 * context; the translator reads and updates it.
 */
export interface OpenCode2TranslationState {
  /** Latest full text emitted per content item key. */
  readonly emittedTextByItemId: Map<string, string>;
  /** Assistant text items already reported as completed. */
  readonly completedItemIds: Set<string>;
  /** Tool names by call id (from `session.tool.input.started`). */
  readonly toolNamesByCallId: Map<string, string>;
  readonly pendingPermissions: Map<string, Permission.Request>;
  readonly pendingQuestions: Map<string, Question.Request>;
  /** Highest durable sequence observed for this session. */
  lastSeq: number | undefined;
}

export function makeOpenCode2TranslationState(): OpenCode2TranslationState {
  return {
    emittedTextByItemId: new Map(),
    completedItemIds: new Set(),
    toolNamesByCallId: new Map(),
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
    lastSeq: undefined,
  };
}

/** Session id carried by one stream event, when present. */
export function openCode2EventSessionId(event: OpenCode2StreamEvent): string | undefined {
  const data = event.data;
  if (!data || typeof data !== "object") return undefined;
  const sessionID = (data as { readonly sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined;
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

/**
 * Merge a full-text observation into the emitted-so-far text. Returns the
 * text to remember plus the suffix still owed to the client. A shorter
 * prefix observation (out-of-order full text) emits nothing new.
 */
export function mergeOpenCode2AssistantText(
  previousText: string | undefined,
  nextText: string,
): { readonly latestText: string; readonly deltaToEmit: string } {
  const latestText =
    previousText && previousText.length > nextText.length && previousText.startsWith(nextText)
      ? previousText
      : nextText;
  return {
    latestText,
    deltaToEmit: latestText.slice(commonPrefixLength(previousText ?? "", latestText)),
  };
}

export function openCode2TextItemId(assistantMessageID: string, ordinal: number): string {
  return `${assistantMessageID}:text:${ordinal}`;
}

export function openCode2ReasoningItemId(assistantMessageID: string, ordinal: number): string {
  return `${assistantMessageID}:reasoning:${ordinal}`;
}

/** Classify an OpenCode tool name into T3's tool lifecycle vocabulary. */
export function toOpenCode2ToolLifecycleItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("bash") || normalized.includes("command")) return "command_execution";
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch") ||
    normalized.includes("multiedit")
  ) {
    return "file_change";
  }
  if (normalized.includes("web")) return "web_search";
  if (normalized.includes("mcp")) return "mcp_tool_call";
  if (normalized.includes("image")) return "image_view";
  if (
    normalized.includes("task") ||
    normalized.includes("agent") ||
    normalized.includes("subtask")
  ) {
    return "collab_agent_tool_call";
  }
  return "dynamic_tool_call";
}

function mapPermissionActionToRequestType(
  action: string,
): "command_execution_approval" | "file_read_approval" | "file_change_approval" | "unknown" {
  switch (action) {
    case "bash":
      return "command_execution_approval";
    case "read":
      return "file_read_approval";
    case "edit":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function mapPermissionReplyToDecision(reply: string): string {
  switch (reply) {
    case "once":
      return "accept";
    case "always":
      return "acceptForSession";
    default:
      return "decline";
  }
}

export function normalizeOpenCode2Questions(
  request: Question.Request,
): ReadonlyArray<UserInputQuestion> {
  return request.questions.map((question, index) => ({
    id: openCode2QuestionId(index, question),
    header: question.header,
    question: question.question,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description,
    })),
    ...(question.multiple ? { multiSelect: true } : {}),
  }));
}

interface TokensLike {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
}

function usageFromTokens(tokens: TokensLike): ThreadTokenUsageSnapshot {
  const input = typeof tokens.input === "number" ? tokens.input : 0;
  const output = typeof tokens.output === "number" ? tokens.output : 0;
  const reasoning = typeof tokens.reasoning === "number" ? tokens.reasoning : 0;
  const cachedInput = typeof tokens.cache?.read === "number" ? tokens.cache.read : 0;
  return {
    usedTokens: input + output + reasoning,
    inputTokens: input,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    cachedInputTokens: cachedInput,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function errorMessageFrom(data: Record<string, unknown> | undefined): string {
  const error = readRecord(data?.error);
  const message = readString(error, "message");
  return message && message.trim().length > 0 ? message : "OpenCode 2 session failed.";
}

function firstTextContent(data: Record<string, unknown> | undefined): string | undefined {
  const content = data?.content;
  if (!Array.isArray(content)) return undefined;
  for (const entry of content) {
    const record = readRecord(entry);
    if (record?.type === "text" && typeof record.text === "string" && record.text.length > 0) {
      return record.text;
    }
  }
  return undefined;
}

/**
 * Translate one session-scoped OpenCode 2 event. Callers filter by session
 * id first; the translator assumes the event belongs to its state.
 */
export function translateOpenCode2Event(
  state: OpenCode2TranslationState,
  event: OpenCode2StreamEvent,
): ReadonlyArray<OpenCode2TranslatedEvent> {
  const seq = event.durable?.seq;
  if (typeof seq === "number") {
    if (state.lastSeq !== undefined && seq <= state.lastSeq) {
      // Durable event already observed (reconnect overlap) — drop it so a
      // resubscribe can never duplicate terminal events.
      return [];
    }
    state.lastSeq = seq;
  }

  const data = readRecord(event.data);

  switch (event.type) {
    case "session.text.delta":
    case "session.reasoning.delta": {
      const assistantMessageID = readString(data, "assistantMessageID");
      const ordinal = readNumber(data, "ordinal");
      const delta = readString(data, "delta");
      if (assistantMessageID === undefined || ordinal === undefined || !delta) return [];
      const reasoning = event.type === "session.reasoning.delta";
      const itemId = reasoning
        ? openCode2ReasoningItemId(assistantMessageID, ordinal)
        : openCode2TextItemId(assistantMessageID, ordinal);
      const previous = state.emittedTextByItemId.get(itemId) ?? "";
      state.emittedTextByItemId.set(itemId, previous + delta);
      return [
        {
          kind: "content.delta",
          itemId,
          streamKind: reasoning ? "reasoning_text" : "assistant_text",
          delta,
        },
      ];
    }

    case "session.text.ended":
    case "session.reasoning.ended": {
      const assistantMessageID = readString(data, "assistantMessageID");
      const ordinal = readNumber(data, "ordinal");
      const text = readString(data, "text");
      if (assistantMessageID === undefined || ordinal === undefined || text === undefined) {
        return [];
      }
      const reasoning = event.type === "session.reasoning.ended";
      const itemId = reasoning
        ? openCode2ReasoningItemId(assistantMessageID, ordinal)
        : openCode2TextItemId(assistantMessageID, ordinal);
      const { latestText, deltaToEmit } = mergeOpenCode2AssistantText(
        state.emittedTextByItemId.get(itemId),
        text,
      );
      state.emittedTextByItemId.set(itemId, latestText);
      const events: Array<OpenCode2TranslatedEvent> = [];
      if (deltaToEmit.length > 0) {
        events.push({
          kind: "content.delta",
          itemId,
          streamKind: reasoning ? "reasoning_text" : "assistant_text",
          delta: deltaToEmit,
        });
      }
      if (!reasoning && latestText.length > 0 && !state.completedItemIds.has(itemId)) {
        state.completedItemIds.add(itemId);
        events.push({ kind: "assistant-message.completed", itemId, text: latestText });
      }
      return events;
    }

    case "session.tool.input.started": {
      const callId = readString(data, "id");
      const name = readString(data, "name");
      if (!callId || !name) return [];
      state.toolNamesByCallId.set(callId, name);
      return [
        {
          kind: "tool.item",
          phase: "started",
          callId,
          itemType: toOpenCode2ToolLifecycleItemType(name),
          status: "inProgress",
          title: name,
        },
      ];
    }

    case "session.tool.called": {
      const callId = readString(data, "id");
      if (!callId) return [];
      const name = state.toolNamesByCallId.get(callId) ?? "tool";
      return [
        {
          kind: "tool.item",
          phase: "updated",
          callId,
          itemType: toOpenCode2ToolLifecycleItemType(name),
          status: "inProgress",
          title: name,
          data: { tool: name, input: data?.input, executed: data?.executed },
        },
      ];
    }

    case "session.tool.progress": {
      const callId = readString(data, "id") ?? readString(data, "callID");
      if (!callId) return [];
      const name = state.toolNamesByCallId.get(callId) ?? "tool";
      const message = readString(data, "message");
      return [
        {
          kind: "tool.item",
          phase: "updated",
          callId,
          itemType: toOpenCode2ToolLifecycleItemType(name),
          status: "inProgress",
          title: name,
          ...(message ? { detail: message } : {}),
          data,
        },
      ];
    }

    case "session.tool.success":
    case "session.tool.failed": {
      const callId = readString(data, "id");
      if (!callId) return [];
      const name = state.toolNamesByCallId.get(callId) ?? "tool";
      state.toolNamesByCallId.delete(callId);
      const failed = event.type === "session.tool.failed";
      const detail = failed ? errorMessageFrom(data) : firstTextContent(data);
      return [
        {
          kind: "tool.item",
          phase: "completed",
          callId,
          itemType: toOpenCode2ToolLifecycleItemType(name),
          status: failed ? "failed" : "completed",
          title: name,
          ...(detail ? { detail } : {}),
          data: { tool: name, ...(failed ? { error: data?.error } : { content: data?.content }) },
        },
      ];
    }

    case "session.execution.succeeded":
      return [{ kind: "turn.completed" }];

    case "session.execution.failed": {
      const message = errorMessageFrom(data);
      return [
        { kind: "turn.failed", message },
        { kind: "runtime.error", message, detail: data?.error },
      ];
    }

    case "session.execution.interrupted": {
      const reason = readString(data, "reason") ?? "user";
      return [{ kind: "turn.interrupted", reason: `Interrupted (${reason}).` }];
    }

    case "session.retry.scheduled": {
      const message = errorMessageFrom(data);
      return [
        {
          kind: "runtime.warning",
          message: `OpenCode 2 retry scheduled: ${message}`,
          detail: data,
        },
      ];
    }

    case "session.step.failed": {
      return [{ kind: "runtime.warning", message: errorMessageFrom(data), detail: data }];
    }

    case "session.renamed": {
      const title = readString(data, "title")?.trim();
      return title && title.length > 0 ? [{ kind: "thread.renamed", title }] : [];
    }

    case "session.usage.updated":
    case "session.step.ended": {
      const tokens = readRecord(data?.tokens);
      if (!tokens) return [];
      return [{ kind: "token-usage", usage: usageFromTokens(tokens as TokensLike) }];
    }

    case "permission.asked": {
      if (!data) return [];
      const request = data as unknown as Permission.Request;
      if (typeof request.id !== "string" || request.id.length === 0) return [];
      state.pendingPermissions.set(request.id, request);
      const resources = Array.isArray(request.resources)
        ? request.resources.filter((value): value is string => typeof value === "string")
        : [];
      return [
        {
          kind: "request.opened",
          requestId: request.id,
          requestType: mapPermissionActionToRequestType(request.action),
          detail: resources.length > 0 ? resources.join("\n") : request.action,
          args: request.metadata,
        },
      ];
    }

    case "permission.replied": {
      const requestId = readString(data, "requestID");
      if (!requestId) return [];
      state.pendingPermissions.delete(requestId);
      return [
        {
          kind: "request.resolved",
          requestId,
          decision: mapPermissionReplyToDecision(readString(data, "reply") ?? "reject"),
        },
      ];
    }

    case "question.asked": {
      if (!data) return [];
      const request = data as unknown as Question.Request;
      if (typeof request.id !== "string" || request.id.length === 0) return [];
      state.pendingQuestions.set(request.id, request);
      return [
        {
          kind: "user-input.requested",
          requestId: request.id,
          questions: normalizeOpenCode2Questions(request),
        },
      ];
    }

    case "question.replied": {
      const requestId = readString(data, "requestID");
      if (!requestId) return [];
      const request = state.pendingQuestions.get(requestId);
      state.pendingQuestions.delete(requestId);
      const rawAnswers = Array.isArray(data?.answers) ? (data?.answers as Array<unknown>) : [];
      const answers = Object.fromEntries(
        (request?.questions ?? []).map((question, index) => {
          const entry = rawAnswers[index];
          const joined = Array.isArray(entry)
            ? entry.filter((value): value is string => typeof value === "string").join(", ")
            : "";
          return [openCode2QuestionId(index, question), joined];
        }),
      );
      return [{ kind: "user-input.resolved", requestId, answers }];
    }

    case "question.rejected": {
      const requestId = readString(data, "requestID");
      if (!requestId) return [];
      state.pendingQuestions.delete(requestId);
      return [{ kind: "user-input.resolved", requestId, answers: {} }];
    }

    default:
      return [];
  }
}
