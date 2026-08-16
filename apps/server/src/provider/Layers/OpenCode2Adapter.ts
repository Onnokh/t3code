/**
 * OpenCode2Adapter — bounded external-server adapter for the OpenCode 2
 * service contract (`/api`, generated `@opencode-ai/client` Effect API).
 *
 * Deliberate boundary (see docs/spec in `Onnokh/digital-home`,
 * `devski-opencode2-strategy.md`):
 *   - external server only: no process discovery, spawn, or update;
 *   - session, model, and configuration state stay owned by the server;
 *   - full-access runtime mode auto-answers permission asks explicitly
 *     (OpenCode 2 sessions no longer accept a creation-time ruleset);
 *   - deferred capabilities fail explicitly instead of approximating
 *     legacy behavior.
 *
 * Streaming design (validated against the pinned real server): the global
 * `/api/event` stream carries durable events (with `durable.seq`) plus
 * ephemeral deltas and permission/question asks. Each session runs one
 * subscription filtered by session id. On stream loss the pump reconnects
 * with backoff and rehydrates from authoritative REST state (session,
 * pending permissions/questions, messages, active executions); durable
 * sequence numbers dedupe any overlap so terminal events are neither lost
 * nor duplicated.
 */
import {
  EventId,
  type OpenCode2Settings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type {
  AbsolutePath,
  Agent,
  Location,
  Model,
  OpenCodeClient,
  Permission,
  Question,
  Session,
  SessionMessage,
} from "@opencode-ai/client/effect";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  makeOpenCode2TranslationState,
  normalizeOpenCode2Questions,
  openCode2EventSessionId,
  openCode2TextItemId,
  mergeOpenCode2AssistantText,
  translateOpenCode2Event,
  type OpenCode2StreamEvent,
  type OpenCode2TranslatedEvent,
  type OpenCode2TranslationState,
} from "../opencode2Events.ts";
import {
  isOpenCode2SessionNotFound,
  makeOpenCode2Client,
  OPENCODE2_PINNED_VERSION,
  openCode2FailureDetail,
  parseOpenCode2ModelSlug,
  runOpenCode2,
  toOpenCode2DataUri,
  toOpenCode2PermissionReply,
  toOpenCode2QuestionAnswers,
  OpenCode2RuntimeError,
} from "../opencode2Runtime.ts";
import { type EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("opencode2");

/**
 * Version tag stamped into the resume cursor. Bump when the cursor shape
 * changes so stale cursors written by older builds are ignored, not
 * misread.
 */
const OPENCODE2_RESUME_VERSION = 1 as const;

/** Consecutive failed (re)connect attempts before the session is torn down. */
const EVENT_STREAM_MAX_CONSECUTIVE_FAILURES = 5;
const EVENT_STREAM_RECONNECT_BASE_MS = 250;
const EVENT_STREAM_RECONNECT_MAX_MS = 5_000;

interface OpenCode2ResumeCursor {
  readonly sessionId: string;
  readonly lastSeq?: number;
}

/**
 * Decode a persisted resume cursor. Anything that is not a current-version
 * cursor with a non-empty session id means "no resume" rather than an
 * error — re-adopting the session id IS the resume mechanism.
 */
export function parseOpenCode2Resume(raw: unknown): OpenCode2ResumeCursor | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== OPENCODE2_RESUME_VERSION) return undefined;
  if (typeof record.sessionId !== "string" || record.sessionId.trim().length === 0) {
    return undefined;
  }
  return {
    sessionId: record.sessionId.trim(),
    ...(typeof record.lastSeq === "number" ? { lastSeq: record.lastSeq } : {}),
  };
}

/**
 * Whether two directory spellings name the same location. Mirrors the
 * legacy provider: lexical equality short-circuits, otherwise both sides
 * canonicalize through `realPath` with a lexical fallback, so the probe
 * can widen matches but never split them.
 */
export function isSameOpenCode2Directory(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  left: string,
  right: string,
): Effect.Effect<boolean> {
  const lexicalLeft = path.resolve(left);
  const lexicalRight = path.resolve(right);
  if (lexicalLeft === lexicalRight) return Effect.succeed(true);
  const canonicalize = (lexical: string) =>
    fileSystem.realPath(lexical).pipe(Effect.orElseSucceed(() => lexical));
  return Effect.zipWith(
    canonicalize(lexicalLeft),
    canonicalize(lexicalRight),
    (canonicalLeft, canonicalRight) => canonicalLeft === canonicalRight,
  );
}

/**
 * Whether `candidate` resolves inside `root` (inclusive). Pure lexical
 * check on already-canonicalized paths.
 */
export function isWithinOpenCode2WorkspaceRoot(
  path: Path.Path,
  root: string,
  candidate: string,
): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return true;
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

interface OpenCode2TurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface OpenCode2SessionContext {
  session: ProviderSession;
  readonly client: OpenCodeClient;
  readonly directory: string;
  readonly openCodeSessionId: string;
  readonly translation: OpenCode2TranslationState;
  readonly turns: Array<OpenCode2TurnSnapshot>;
  activeTurnId: TurnId | undefined;
  /** Last model ref pushed to the server, as a `provider/model[/variant]` key. */
  currentModelKey: string | undefined;
  currentAgent: string | undefined;
  readonly stopped: Ref.Ref<boolean>;
  readonly sessionScope: Scope.Closeable;
}

export interface OpenCode2AdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

export interface OpenCode2AdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const toRequestError = (cause: OpenCode2RuntimeError): ProviderAdapterRequestError =>
  new ProviderAdapterRequestError({
    provider: PROVIDER,
    method: cause.operation,
    detail: cause.detail,
    cause: cause.cause,
  });

const toProcessError = (threadId: ThreadId, cause: unknown): ProviderAdapterProcessError =>
  new ProviderAdapterProcessError({
    provider: PROVIDER,
    threadId,
    detail: OpenCode2RuntimeError.is(cause) ? cause.detail : openCode2FailureDetail(cause),
    cause,
  });

type EventBaseInput = {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly raw?: unknown;
};

const ensureSessionContext = Effect.fn("ensureSessionContext")(function* (
  sessions: ReadonlyMap<ThreadId, OpenCode2SessionContext>,
  threadId: ThreadId,
) {
  const session = sessions.get(threadId);
  if (!session) {
    return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
  }
  if (yield* Ref.get(session.stopped)) {
    return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
  }
  return session;
});

const stopOpenCode2Context = Effect.fn("stopOpenCode2Context")(function* (
  context: OpenCode2SessionContext,
) {
  if (yield* Ref.getAndSet(context.stopped, true)) {
    return false;
  }
  // Best-effort remote interrupt: any in-flight execution should stop, but
  // the session itself stays server-owned and resumable.
  yield* runOpenCode2(
    "session.interrupt",
    context.client.session.interrupt({ sessionID: asSessionId(context.openCodeSessionId) }),
  ).pipe(Effect.ignore({ log: true }));
  yield* Scope.close(context.sessionScope, Exit.void);
  return true;
});

// The generated client uses branded ids throughout. The adapter's inputs
// arrive as plain strings from T3 contracts; these narrowing helpers keep
// the unavoidable brand casts in one visible place.
const asSessionId = (value: string): Session.ID => value as Session.ID;
const asMessageId = (value: string): SessionMessage.ID => value as SessionMessage.ID;
const asAgentId = (value: string): Agent.ID => value as Agent.ID;
const asPermissionId = (value: string): Permission.ID => value as Permission.ID;
const asQuestionId = (value: string): Question.ID => value as Question.ID;

function toModelRef(input: {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string | undefined;
}): Model.Ref {
  return {
    providerID: input.providerID,
    id: input.modelID,
    ...(input.variant ? { variant: input.variant } : {}),
  } as Model.Ref;
}

function toLocationRef(directory: string): Location.Ref {
  return { directory: directory as AbsolutePath };
}

function modelKey(input: {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string | undefined;
}): string {
  return `${input.providerID}/${input.modelID}${input.variant ? `/${input.variant}` : ""}`;
}

export function makeOpenCode2Adapter(
  settings: OpenCode2Settings,
  options?: OpenCode2AdapterOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("opencode2");
    const serverConfig = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const nativeEventLogger = options?.nativeEventLogger;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, OpenCode2SessionContext>();

    const sameDirectory = (left: string, right: string) =>
      isSameOpenCode2Directory(fileSystem, path, left, right);

    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate OpenCode 2 runtime identifier.",
            cause,
          }),
      ),
    );

    const buildEventBase = (input: EventBaseInput) =>
      Effect.all({
        eventId: randomUUIDv4.pipe(Effect.map(EventId.make)),
        createdAt: nowIso,
      }).pipe(
        Effect.map(({ eventId, createdAt }) => ({
          eventId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
          ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
          ...(input.raw !== undefined
            ? { raw: { source: "opencode.sdk.event" as const, payload: input.raw } }
            : {}),
        })),
      );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(
          contexts,
          (context) => Effect.ignoreCause(stopOpenCode2Context(context)),
          { concurrency: "unbounded", discard: true },
        );
      }).pipe(Effect.ensuring(Queue.shutdown(runtimeEvents))),
    );

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const writeNativeEventBestEffort = (
      threadId: ThreadId,
      event: { readonly observedAt: string; readonly event: Record<string, unknown> },
    ) =>
      nativeEventLogger
        ? nativeEventLogger.write(event, threadId).pipe(Effect.catchCause(() => Effect.void))
        : Effect.void;

    const requireExternalServer = Effect.fn("requireExternalServer")(function* (
      threadId: ThreadId,
    ) {
      const serverUrl = settings.serverUrl.trim();
      if (serverUrl.length === 0) {
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId,
          detail:
            "No OpenCode 2 server URL is configured. The opencode2 provider is external-server only.",
        });
      }
      return serverUrl;
    });

    const makeClient = makeOpenCode2Client({
      serverUrl: settings.serverUrl.trim(),
      ...(settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));

    /**
     * Enforce the pinned-version contract. A server on any other build is
     * a sanitized unavailable state, never a silent incompatible fallback.
     */
    const assertPinnedServer = Effect.fn("assertPinnedServer")(function* (client: OpenCodeClient) {
      const health = yield* runOpenCode2("health.get", client.health.get());
      if (health.version !== OPENCODE2_PINNED_VERSION) {
        return yield* new OpenCode2RuntimeError({
          operation: "health.get",
          detail: `OpenCode 2 server build '${health.version}' does not match the pinned client build '${OPENCODE2_PINNED_VERSION}'. Server and client must be updated together.`,
        });
      }
    });

    const emitUnexpectedExit = Effect.fn("emitUnexpectedExit")(function* (
      context: OpenCode2SessionContext,
      message: string,
    ) {
      if (yield* Ref.getAndSet(context.stopped, true)) {
        return;
      }
      const turnId = context.activeTurnId;
      sessions.delete(context.session.threadId);
      yield* emit({
        ...(yield* buildEventBase({ threadId: context.session.threadId, turnId })),
        type: "runtime.error",
        payload: { message, class: "transport_error" },
      }).pipe(Effect.ignore);
      yield* emit({
        ...(yield* buildEventBase({ threadId: context.session.threadId, turnId })),
        type: "session.exited",
        payload: { reason: message, recoverable: false, exitKind: "error" },
      }).pipe(Effect.ignore);
      yield* runOpenCode2(
        "session.interrupt",
        context.client.session.interrupt({ sessionID: asSessionId(context.openCodeSessionId) }),
      ).pipe(Effect.ignore({ log: true }));
      yield* Scope.close(context.sessionScope, Exit.void);
    });

    const updateProviderSession = (
      context: OpenCode2SessionContext,
      patch: Partial<ProviderSession>,
      updateOptions?: {
        readonly clearActiveTurnId?: boolean;
        readonly clearLastError?: boolean;
      },
    ): Effect.Effect<ProviderSession> =>
      Effect.gen(function* () {
        const updatedAt = yield* nowIso;
        const nextSession = {
          ...context.session,
          ...patch,
          updatedAt,
        } as ProviderSession & Record<string, unknown>;
        const mutableSession = nextSession as Record<string, unknown>;
        if (updateOptions?.clearActiveTurnId) {
          delete mutableSession.activeTurnId;
        }
        if (updateOptions?.clearLastError) {
          delete mutableSession.lastError;
        }
        context.session = nextSession;
        return nextSession;
      });

    const buildResumeCursor = (context: OpenCode2SessionContext): Record<string, unknown> => ({
      schemaVersion: OPENCODE2_RESUME_VERSION,
      sessionId: context.openCodeSessionId,
      ...(context.translation.lastSeq !== undefined
        ? { lastSeq: context.translation.lastSeq }
        : {}),
    });

    /**
     * Emit one translated event as a canonical runtime event. Full-access
     * permission asks are answered here explicitly instead of surfacing an
     * approval the user already granted by mode selection.
     */
    const emitTranslated = Effect.fn("emitTranslated")(function* (
      context: OpenCode2SessionContext,
      translated: OpenCode2TranslatedEvent,
      raw: unknown,
    ) {
      const threadId = context.session.threadId;
      const turnId = context.activeTurnId;
      switch (translated.kind) {
        case "content.delta": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, itemId: translated.itemId, raw })),
            type: "content.delta",
            payload: { streamKind: translated.streamKind, delta: translated.delta },
          });
          return;
        }
        case "assistant-message.completed": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, itemId: translated.itemId, raw })),
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
              ...(translated.text.length > 0 ? { detail: translated.text } : {}),
            },
          });
          return;
        }
        case "tool.item": {
          const payload = {
            itemType: translated.itemType,
            status: translated.status,
            ...(translated.title ? { title: translated.title } : {}),
            ...(translated.detail ? { detail: translated.detail } : {}),
            ...(translated.data !== undefined ? { data: translated.data } : {}),
          };
          appendTurnItem(context, turnId, payload);
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, itemId: translated.callId, raw })),
            type:
              translated.phase === "started"
                ? "item.started"
                : translated.phase === "completed"
                  ? "item.completed"
                  : "item.updated",
            payload,
          });
          return;
        }
        case "turn.completed": {
          if (!turnId) return;
          context.activeTurnId = undefined;
          yield* updateProviderSession(context, { status: "ready" }, { clearActiveTurnId: true });
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw })),
            type: "turn.completed",
            payload: { state: "completed" },
          });
          return;
        }
        case "turn.failed": {
          const failedTurnId = turnId;
          context.activeTurnId = undefined;
          yield* updateProviderSession(
            context,
            { status: "error", lastError: translated.message },
            { clearActiveTurnId: true },
          );
          if (failedTurnId) {
            yield* emit({
              ...(yield* buildEventBase({ threadId, turnId: failedTurnId, raw })),
              type: "turn.completed",
              payload: { state: "failed", errorMessage: translated.message },
            });
          }
          return;
        }
        case "turn.interrupted": {
          if (!turnId) return;
          context.activeTurnId = undefined;
          yield* updateProviderSession(context, { status: "ready" }, { clearActiveTurnId: true });
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw })),
            type: "turn.aborted",
            payload: { reason: translated.reason },
          });
          return;
        }
        case "thread.renamed": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, raw })),
            type: "thread.metadata.updated",
            payload: {
              name: translated.title,
              metadata: { sessionID: context.openCodeSessionId },
            },
          });
          return;
        }
        case "token-usage": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw })),
            type: "thread.token-usage.updated",
            payload: { usage: translated.usage },
          });
          return;
        }
        case "request.opened": {
          if (context.session.runtimeMode === "full-access") {
            // Explicit auto-answer: OpenCode 2 has no session-creation
            // ruleset, so full-access is implemented as an immediate,
            // logged "always" reply rather than a fake server-side rule.
            context.translation.pendingPermissions.delete(translated.requestId);
            yield* Effect.logDebug(
              `OpenCode 2 auto-approving permission '${translated.requestId}' (full-access runtime mode).`,
            );
            yield* runOpenCode2(
              "permission.reply",
              context.client.permission.reply({
                sessionID: asSessionId(context.openCodeSessionId),
                requestID: asPermissionId(translated.requestId),
                reply: "always",
              }),
            ).pipe(Effect.ignore({ log: true }));
            return;
          }
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, requestId: translated.requestId, raw })),
            type: "request.opened",
            payload: {
              requestType: translated.requestType,
              detail: translated.detail,
              ...(translated.args !== undefined ? { args: translated.args } : {}),
            },
          });
          return;
        }
        case "request.resolved": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, requestId: translated.requestId, raw })),
            type: "request.resolved",
            payload: { requestType: "unknown", decision: translated.decision },
          });
          return;
        }
        case "user-input.requested": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, requestId: translated.requestId, raw })),
            type: "user-input.requested",
            payload: { questions: translated.questions },
          });
          return;
        }
        case "user-input.resolved": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, requestId: translated.requestId, raw })),
            type: "user-input.resolved",
            payload: { answers: translated.answers },
          });
          return;
        }
        case "runtime.warning": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw })),
            type: "runtime.warning",
            payload: {
              message: translated.message,
              ...(translated.detail !== undefined ? { detail: translated.detail } : {}),
            },
          });
          return;
        }
        case "runtime.error": {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw })),
            type: "runtime.error",
            payload: {
              message: translated.message,
              class: "provider_error",
              ...(translated.detail !== undefined ? { detail: translated.detail } : {}),
            },
          });
          return;
        }
        default:
          return;
      }
    });

    const handleStreamEvent = Effect.fn("handleStreamEvent")(function* (
      context: OpenCode2SessionContext,
      event: OpenCode2StreamEvent,
    ) {
      if (openCode2EventSessionId(event) !== context.openCodeSessionId) {
        return;
      }
      yield* writeNativeEventBestEffort(context.session.threadId, {
        observedAt: yield* nowIso,
        event: {
          provider: PROVIDER,
          threadId: context.session.threadId,
          providerThreadId: context.openCodeSessionId,
          type: event.type,
          ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
          payload: event,
        },
      });
      const translatedEvents = translateOpenCode2Event(context.translation, event);
      for (const translated of translatedEvents) {
        yield* emitTranslated(context, translated, event);
      }
    });

    /**
     * Reconcile authoritative REST state after an event-stream gap:
     * re-surface still-pending permissions/questions, replay missed
     * assistant text as deltas, and close a turn whose execution finished
     * while the stream was down.
     */
    const rehydrateAfterReconnect = Effect.fn("rehydrateAfterReconnect")(function* (
      context: OpenCode2SessionContext,
    ) {
      const sessionID = asSessionId(context.openCodeSessionId);

      const pendingPermissions = yield* runOpenCode2(
        "permission.list",
        context.client.permission.list({ sessionID }),
      );
      for (const request of pendingPermissions) {
        if (context.translation.pendingPermissions.has(request.id)) continue;
        yield* handleStreamEvent(context, {
          type: "permission.asked",
          data: request,
        });
      }

      const pendingQuestions = yield* runOpenCode2(
        "question.list",
        context.client.question.list({ sessionID }),
      );
      for (const request of pendingQuestions) {
        if (context.translation.pendingQuestions.has(request.id)) continue;
        yield* handleStreamEvent(context, {
          type: "question.asked",
          data: request,
        });
      }

      // Reconcile the latest assistant text so a delta gap cannot lose
      // content: whatever the server has that we have not emitted becomes
      // one catch-up delta (plus completion, if the message finished).
      const messages = yield* runOpenCode2(
        "message.list",
        context.client.message.list({ sessionID, limit: 10, order: "desc" }),
      );
      for (const message of messages.data) {
        if (message.type !== "assistant") continue;
        let ordinal = 0;
        for (const content of message.content) {
          if (content.type !== "text") {
            ordinal += content.type === "reasoning" ? 1 : 0;
            continue;
          }
          const itemId = openCode2TextItemId(message.id, ordinal);
          ordinal += 1;
          const { latestText, deltaToEmit } = mergeOpenCode2AssistantText(
            context.translation.emittedTextByItemId.get(itemId),
            content.text,
          );
          context.translation.emittedTextByItemId.set(itemId, latestText);
          if (deltaToEmit.length > 0) {
            yield* emitTranslated(
              context,
              { kind: "content.delta", itemId, streamKind: "assistant_text", delta: deltaToEmit },
              { source: "rehydrate" },
            );
          }
          if (
            message.time.completed !== undefined &&
            latestText.length > 0 &&
            !context.translation.completedItemIds.has(itemId)
          ) {
            context.translation.completedItemIds.add(itemId);
            yield* emitTranslated(
              context,
              { kind: "assistant-message.completed", itemId, text: latestText },
              { source: "rehydrate" },
            );
          }
        }
        break;
      }

      if (context.activeTurnId !== undefined) {
        const active = yield* runOpenCode2("session.active", context.client.session.active());
        const stillRunning = Object.prototype.hasOwnProperty.call(
          active,
          context.openCodeSessionId,
        );
        if (!stillRunning) {
          // The execution reached a terminal state while the stream was
          // down. The latest assistant message tells success from failure.
          const latestAssistant = messages.data.find(
            (message: SessionMessage.Info) => message.type === "assistant",
          );
          const errorMessage =
            latestAssistant !== undefined &&
            "error" in latestAssistant &&
            latestAssistant.error !== undefined
              ? openCode2FailureDetail(latestAssistant.error)
              : undefined;
          yield* emitTranslated(
            context,
            errorMessage !== undefined
              ? { kind: "turn.failed", message: errorMessage }
              : { kind: "turn.completed" },
            { source: "rehydrate" },
          );
        }
      }
    });

    const startEventPump = Effect.fn("startEventPump")(function* (
      context: OpenCode2SessionContext,
    ) {
      const pump = Effect.gen(function* () {
        let consecutiveFailures = 0;
        let reconnected = false;
        for (;;) {
          if (yield* Ref.get(context.stopped)) return;
          let sawEvent = false;
          if (reconnected) {
            const rehydrateExit = yield* Effect.exit(rehydrateAfterReconnect(context));
            if (Exit.isFailure(rehydrateExit)) {
              const cause = Cause.squash(rehydrateExit.cause);
              if (isOpenCode2SessionNotFound(cause)) {
                yield* emitUnexpectedExit(
                  context,
                  "OpenCode 2 session no longer exists on the server.",
                );
                return;
              }
              yield* Effect.logWarning(
                `OpenCode 2 rehydration failed: ${openCode2FailureDetail(cause)}`,
              );
            }
          }
          const exit = yield* Effect.exit(
            context.client.event.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  sawEvent = true;
                  yield* handleStreamEvent(context, event as OpenCode2StreamEvent);
                }),
              ),
            ),
          );
          if (yield* Ref.get(context.stopped)) return;
          if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return;
          // The volatile stream ended or failed. Events may have been
          // missed; reconnect with backoff and rehydrate.
          consecutiveFailures = sawEvent ? 1 : consecutiveFailures + 1;
          reconnected = true;
          if (consecutiveFailures > EVENT_STREAM_MAX_CONSECUTIVE_FAILURES) {
            const detail = Exit.isFailure(exit)
              ? openCode2FailureDetail(Cause.squash(exit.cause))
              : "OpenCode 2 event stream closed repeatedly.";
            yield* emitUnexpectedExit(
              context,
              `Lost the OpenCode 2 event stream after repeated reconnect attempts: ${detail}`,
            );
            return;
          }
          const backoffMs = Math.min(
            EVENT_STREAM_RECONNECT_BASE_MS * 2 ** (consecutiveFailures - 1),
            EVENT_STREAM_RECONNECT_MAX_MS,
          );
          yield* Effect.sleep(`${backoffMs} millis`);
        }
      });
      yield* pump.pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterruptsOnly(cause)) return;
            yield* emitUnexpectedExit(
              context,
              `OpenCode 2 event pump failed: ${openCode2FailureDetail(Cause.squash(cause))}`,
            ).pipe(Effect.ignore);
          }),
        ),
        Effect.forkIn(context.sessionScope),
      );
    });

    const startSession: OpenCode2AdapterShape["startSession"] = Effect.fn("startSession")(
      function* (input) {
        yield* requireExternalServer(input.threadId);
        const directory = input.cwd ?? serverConfig.cwd;
        const workspaceRoot = settings.workspaceRoot.trim();
        if (workspaceRoot.length > 0) {
          const canonicalDirectory = yield* fileSystem
            .realPath(path.resolve(directory))
            .pipe(Effect.orElseSucceed(() => path.resolve(directory)));
          const canonicalRoot = yield* fileSystem
            .realPath(path.resolve(workspaceRoot))
            .pipe(Effect.orElseSucceed(() => path.resolve(workspaceRoot)));
          if (!isWithinOpenCode2WorkspaceRoot(path, canonicalRoot, canonicalDirectory)) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Session directory '${directory}' resolves outside the Code Workspace Root '${workspaceRoot}'.`,
            });
          }
        }

        const resume = parseOpenCode2Resume(input.resumeCursor);
        const existing = sessions.get(input.threadId);
        if (existing) {
          yield* stopOpenCode2Context(existing);
          sessions.delete(input.threadId);
        }

        const parsedModel = parseOpenCode2ModelSlug(input.modelSelection?.model);
        const modelVariant = getModelSelectionStringOptionValue(input.modelSelection, "variant");

        const started = yield* Effect.gen(function* () {
          const sessionScope = yield* Scope.make();
          const startedExit = yield* Effect.exit(
            Effect.gen(function* () {
              const client = yield* makeClient;
              yield* assertPinnedServer(client);

              const adopted = resume
                ? yield* runOpenCode2(
                    "session.get",
                    client.session.get({ sessionID: asSessionId(resume.sessionId) }),
                  ).pipe(
                    Effect.map((session): Session.Info | undefined => session),
                    Effect.catchIf(
                      (cause) => isOpenCode2SessionNotFound(cause),
                      () => Effect.succeed(undefined),
                    ),
                  )
                : undefined;

              if (adopted) {
                const adoptedDirectory = adopted.location.directory;
                const sameDir = yield* sameDirectory(adoptedDirectory, directory);
                if (!sameDir) {
                  // The thread moved (e.g. into a git worktree). OpenCode 2
                  // separates fork and move; the bounded v1 rule is to move
                  // the session so its full history follows the thread.
                  yield* Effect.logInfo(
                    `OpenCode 2 session '${adopted.id}' lives under a different directory; moving it to '${directory}' to preserve conversation history.`,
                  );
                  yield* runOpenCode2(
                    "session.move",
                    client.session.move({
                      sessionID: adopted.id,
                      directory: directory as AbsolutePath,
                    }),
                  );
                }
                return { client, openCodeSession: adopted, created: false, sessionScope };
              }

              if (resume) {
                yield* Effect.logWarning(
                  `OpenCode 2 session '${resume.sessionId}' no longer exists; starting a fresh session.`,
                );
              }
              const createdSession = yield* runOpenCode2(
                "session.create",
                client.session.create({
                  location: toLocationRef(directory),
                  ...(parsedModel
                    ? {
                        model: toModelRef({
                          providerID: parsedModel.providerID,
                          modelID: parsedModel.modelID,
                          ...(modelVariant ? { variant: modelVariant } : {}),
                        }),
                      }
                    : {}),
                }),
              );
              return { client, openCodeSession: createdSession, created: true, sessionScope };
            }).pipe(Effect.provideService(Scope.Scope, sessionScope)),
          );
          if (Exit.isFailure(startedExit)) {
            yield* Scope.close(sessionScope, Exit.void).pipe(Effect.ignore);
            return yield* toProcessError(input.threadId, Cause.squash(startedExit.cause));
          }
          return startedExit.value;
        });

        const raceWinner = sessions.get(input.threadId);
        if (raceWinner) {
          yield* Scope.close(started.sessionScope, Exit.void).pipe(Effect.ignore);
          return raceWinner.session;
        }

        const createdAt = yield* nowIso;
        const translation = makeOpenCode2TranslationState();
        if (resume?.lastSeq !== undefined) {
          translation.lastSeq = resume.lastSeq;
        }
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: directory,
          ...(input.modelSelection ? { model: input.modelSelection.model } : {}),
          threadId: input.threadId,
          resumeCursor: {
            schemaVersion: OPENCODE2_RESUME_VERSION,
            sessionId: started.openCodeSession.id,
            ...(translation.lastSeq !== undefined ? { lastSeq: translation.lastSeq } : {}),
          },
          createdAt,
          updatedAt: createdAt,
        };

        const context: OpenCode2SessionContext = {
          session,
          client: started.client,
          directory,
          openCodeSessionId: started.openCodeSession.id,
          translation,
          turns: [],
          activeTurnId: undefined,
          currentModelKey:
            parsedModel !== null
              ? modelKey({
                  providerID: parsedModel.providerID,
                  modelID: parsedModel.modelID,
                  ...(modelVariant ? { variant: modelVariant } : {}),
                })
              : undefined,
          currentAgent: undefined,
          stopped: yield* Ref.make(false),
          sessionScope: started.sessionScope,
        };
        sessions.set(input.threadId, context);
        yield* startEventPump(context);

        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "session.started",
          payload: { message: "OpenCode 2 session started" },
        });
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "thread.started",
          payload: { providerThreadId: started.openCodeSession.id },
        });

        return session;
      },
    );

    const sendTurn: OpenCode2AdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const context = yield* ensureSessionContext(sessions, input.threadId);
      const steeringTurnId = context.activeTurnId;
      const turnId = steeringTurnId ?? TurnId.make(`opencode2-turn-${yield* randomUUIDv4}`);
      const modelSelection =
        input.modelSelection ??
        (context.session.model
          ? { instanceId: boundInstanceId, model: context.session.model }
          : undefined);
      if (modelSelection !== undefined && modelSelection.instanceId !== boundInstanceId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `OpenCode 2 model selection is bound to instance '${modelSelection.instanceId}', expected '${boundInstanceId}'.`,
        });
      }
      const parsedModel = parseOpenCode2ModelSlug(modelSelection?.model);
      if (!parsedModel) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "OpenCode 2 model selection must use the 'provider/model' format.",
        });
      }
      const variant = getModelSelectionStringOptionValue(modelSelection, "variant");
      const agentOption = getModelSelectionStringOptionValue(modelSelection, "agent");
      const desiredAgent = input.interactionMode === "plan" ? "plan" : agentOption;

      const text = input.input?.trim() ?? "";
      const files: Array<{ readonly uri: string; readonly name?: string }> = [];
      for (const attachment of input.attachments ?? []) {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) continue;
        const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "attachment.read",
                detail: `Failed to read attachment '${attachment.name}'.`,
                cause,
              }),
          ),
        );
        const uri = toOpenCode2DataUri({ mimeType: attachment.mimeType, bytes });
        if (uri === null) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Attachment '${attachment.name}' exceeds the OpenCode 2 inline attachment limit.`,
          });
        }
        files.push({ uri, name: attachment.name });
      }
      if (text.length === 0 && files.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "OpenCode 2 turns require text input or at least one attachment.",
        });
      }

      const desiredModelKey = modelKey({
        providerID: parsedModel.providerID,
        modelID: parsedModel.modelID,
        ...(variant ? { variant } : {}),
      });
      if (context.currentModelKey !== desiredModelKey) {
        yield* runOpenCode2(
          "session.switchModel",
          context.client.session.switchModel({
            sessionID: asSessionId(context.openCodeSessionId),
            model: toModelRef({
              providerID: parsedModel.providerID,
              modelID: parsedModel.modelID,
              ...(variant ? { variant } : {}),
            }),
          }),
        ).pipe(Effect.mapError(toRequestError));
        context.currentModelKey = desiredModelKey;
      }
      if (desiredAgent !== undefined && desiredAgent !== context.currentAgent) {
        yield* runOpenCode2(
          "session.switchAgent",
          context.client.session.switchAgent({
            sessionID: asSessionId(context.openCodeSessionId),
            agent: asAgentId(desiredAgent),
          }),
        ).pipe(Effect.mapError(toRequestError));
        context.currentAgent = desiredAgent;
      }

      context.activeTurnId = turnId;
      yield* updateProviderSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          model: modelSelection?.model ?? context.session.model,
        },
        { clearLastError: true },
      );

      if (steeringTurnId === undefined) {
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
          type: "turn.started",
          payload: {
            model: modelSelection?.model ?? context.session.model,
            ...(variant ? { effort: variant } : {}),
          },
        });
      }

      yield* runOpenCode2(
        "session.prompt",
        context.client.session.prompt({
          sessionID: asSessionId(context.openCodeSessionId),
          text,
          ...(files.length > 0 ? { files } : {}),
          ...(steeringTurnId !== undefined ? { delivery: "steer" as const } : {}),
        }),
      ).pipe(
        Effect.mapError(toRequestError),
        Effect.tapError((requestError) =>
          steeringTurnId !== undefined
            ? Effect.void
            : Effect.gen(function* () {
                context.activeTurnId = undefined;
                yield* updateProviderSession(
                  context,
                  {
                    status: "ready",
                    model: modelSelection?.model ?? context.session.model,
                    lastError: requestError.detail,
                  },
                  { clearActiveTurnId: true },
                );
                yield* emit({
                  ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                  type: "turn.aborted",
                  payload: { reason: requestError.detail },
                });
              }),
        ),
      );

      yield* updateProviderSession(context, { resumeCursor: buildResumeCursor(context) });

      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: buildResumeCursor(context),
      };
    });

    const interruptTurn: OpenCode2AdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId, turnId) {
        const context = yield* ensureSessionContext(sessions, threadId);
        yield* runOpenCode2(
          "session.interrupt",
          context.client.session.interrupt({
            sessionID: asSessionId(context.openCodeSessionId),
          }),
        ).pipe(Effect.mapError(toRequestError));
        const abortedTurnId = turnId ?? context.activeTurnId;
        if (abortedTurnId) {
          // Clear immediately so the durable `session.execution.interrupted`
          // event cannot emit a duplicate abort for the same turn.
          context.activeTurnId = undefined;
          yield* updateProviderSession(context, { status: "ready" }, { clearActiveTurnId: true });
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: abortedTurnId })),
            type: "turn.aborted",
            payload: { reason: "Interrupted by user." },
          });
        }
      },
    );

    const respondToRequest: OpenCode2AdapterShape["respondToRequest"] = Effect.fn(
      "respondToRequest",
    )(function* (threadId, requestId, decision) {
      const context = yield* ensureSessionContext(sessions, threadId);
      if (!context.translation.pendingPermissions.has(requestId)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "permission.reply",
          detail: `Unknown pending permission request: ${requestId}`,
        });
      }
      yield* runOpenCode2(
        "permission.reply",
        context.client.permission.reply({
          sessionID: asSessionId(context.openCodeSessionId),
          requestID: asPermissionId(requestId),
          reply: toOpenCode2PermissionReply(decision),
        }),
      ).pipe(Effect.mapError(toRequestError));
    });

    const respondToUserInput: OpenCode2AdapterShape["respondToUserInput"] = Effect.fn(
      "respondToUserInput",
    )(function* (threadId, requestId, answers) {
      const context = yield* ensureSessionContext(sessions, threadId);
      const request = context.translation.pendingQuestions.get(requestId);
      if (!request) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "question.reply",
          detail: `Unknown pending user-input request: ${requestId}`,
        });
      }
      yield* runOpenCode2(
        "question.reply",
        context.client.question.reply({
          sessionID: asSessionId(context.openCodeSessionId),
          requestID: asQuestionId(requestId),
          answers: toOpenCode2QuestionAnswers(request, answers),
        }),
      ).pipe(Effect.mapError(toRequestError));
    });

    const stopSession: OpenCode2AdapterShape["stopSession"] = Effect.fn("stopSession")(
      function* (threadId) {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        }
        const stopped = yield* stopOpenCode2Context(context);
        sessions.delete(threadId);
        if (!stopped) return;
        yield* emit({
          ...(yield* buildEventBase({ threadId })),
          type: "session.exited",
          payload: { reason: "Session stopped.", recoverable: false, exitKind: "graceful" },
        });
      },
    );

    const listSessions: OpenCode2AdapterShape["listSessions"] = () =>
      Effect.sync(() => [...sessions.values()].map((context) => context.session));

    const hasSession: OpenCode2AdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const listAllMessages = Effect.fn("listAllMessages")(function* (
      context: OpenCode2SessionContext,
    ) {
      interface MessagePage {
        readonly data: ReadonlyArray<SessionMessage.Info>;
        readonly cursor: {
          readonly previous?: string | undefined;
          readonly next?: string | undefined;
        };
      }
      const collected: Array<SessionMessage.Info> = [];
      let cursor: string | undefined = undefined;
      for (let page = 0; page < 50; page += 1) {
        // The server rejects `order` combined with `cursor`; the cursor
        // itself encodes the traversal direction after the first page.
        const result: MessagePage = yield* runOpenCode2(
          "message.list",
          context.client.message.list({
            sessionID: asSessionId(context.openCodeSessionId),
            ...(cursor === undefined ? { order: "asc" as const } : { cursor }),
          }),
        ).pipe(Effect.mapError(toRequestError));
        collected.push(...result.data);
        if (result.data.length === 0 || result.cursor.next === undefined) break;
        cursor = result.cursor.next;
      }
      return collected;
    });

    const readThread: OpenCode2AdapterShape["readThread"] = Effect.fn("readThread")(
      function* (threadId) {
        const context = yield* ensureSessionContext(sessions, threadId);
        const messages = yield* listAllMessages(context);
        const turns: Array<OpenCode2TurnSnapshot> = [];
        for (const message of messages) {
          if (message.type === "assistant") {
            turns.push({
              id: TurnId.make(message.id),
              items: [message, ...message.content],
            });
          }
        }
        return { threadId, turns };
      },
    );

    const rollbackThread: OpenCode2AdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
      function* (threadId, numTurns) {
        const context = yield* ensureSessionContext(sessions, threadId);
        const messages = yield* listAllMessages(context);
        const assistantMessages = messages.filter((message) => message.type === "assistant");
        const targetIndex = assistantMessages.length - numTurns - 1;
        const target = targetIndex >= 0 ? assistantMessages[targetIndex] : undefined;
        if (!target) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: `Cannot roll back ${numTurns} turn(s): the OpenCode 2 revert transaction requires an earlier assistant message to remain.`,
          });
        }
        // OpenCode 2 reverts are staged transactions; stage to the target
        // message, then commit.
        yield* runOpenCode2(
          "session.revert.stage",
          context.client.session.revert.stage({
            sessionID: asSessionId(context.openCodeSessionId),
            messageID: asMessageId(target.id),
          }),
        ).pipe(Effect.mapError(toRequestError));
        yield* runOpenCode2(
          "session.revert.commit",
          context.client.session.revert.commit({
            sessionID: asSessionId(context.openCodeSessionId),
          }),
        ).pipe(Effect.mapError(toRequestError));
        return yield* readThread(threadId);
      },
    );

    const stopAll: OpenCode2AdapterShape["stopAll"] = () =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(
          contexts,
          (context) => Effect.ignoreCause(stopOpenCode2Context(context)),
          { concurrency: "unbounded", discard: true },
        );
      });

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies OpenCode2AdapterShape;
  });
}

function appendTurnItem(
  context: OpenCode2SessionContext,
  turnId: TurnId | undefined,
  item: unknown,
): void {
  if (!turnId) return;
  const existing = context.turns.find((turn) => turn.id === turnId);
  if (existing) {
    existing.items.push(item);
    return;
  }
  context.turns.push({ id: turnId, items: [item] });
}

export { normalizeOpenCode2Questions };
