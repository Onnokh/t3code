/**
 * opencode2Runtime — client construction and pure helpers for the bounded
 * external-server OpenCode 2 provider.
 *
 * The `opencode2` driver talks to a private, version-matched OpenCode 2
 * server through the generated `@opencode-ai/client` Effect API (the new
 * `/api` service contract). It never spawns, discovers, or updates a local
 * OpenCode process — that is the deliberate boundary accepted in the Devski
 * OpenCode 2 compatibility strategy.
 *
 * Everything in this module is either pure or only requires `HttpClient`;
 * the adapter and provider snapshot layers build on top of it.
 *
 * @module provider/opencode2Runtime
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { OpenCode, type OpenCodeClient, Question } from "@opencode-ai/client/effect";

import type { ProviderApprovalDecision } from "@t3tools/contracts";

/**
 * The exact numeric OpenCode prerelease this build is compatible with.
 * CLI/server and `@opencode-ai/client` MUST move together; the provider
 * refuses to run against any other server build rather than degrading
 * silently. Keep in sync with the `@opencode-ai/client` pin in
 * `apps/server/package.json` and the deployment pins in
 * `infra/devski-code/`.
 */
export const OPENCODE2_PINNED_VERSION = "0.0.0-next-17199";

const OPENCODE2_RUNTIME_ERROR_TAG = "OpenCode2RuntimeError";

/**
 * Tagged failure for every OpenCode 2 client operation. `detail` is always
 * sanitized: it never contains the server password, Authorization headers,
 * or raw request dumps — see {@link openCode2FailureDetail}.
 */
export class OpenCode2RuntimeError extends Data.TaggedError(OPENCODE2_RUNTIME_ERROR_TAG)<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  static readonly is = (u: unknown): u is OpenCode2RuntimeError =>
    P.isTagged(u, OPENCODE2_RUNTIME_ERROR_TAG);
}

const encodeUnknownJsonString = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

function readTag(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tag = (value as { readonly _tag?: unknown })._tag;
  return typeof tag === "string" && tag.length > 0 ? tag : undefined;
}

function readMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = (value as { readonly message?: unknown }).message;
  const trimmed = typeof message === "string" ? message.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Produce a human-readable, credential-free description of a client
 * failure.
 *
 * The generated Effect client fails with typed values: protocol errors
 * (`UnauthorizedError`, `SessionNotFoundError`, …), `ClientError`,
 * `SchemaError`, and `HttpClientError`. An `HttpClientError` carries the
 * full outgoing request — including the Basic Authorization header — so
 * this function NEVER serializes causes wholesale. It only reads tags,
 * top-level messages, and response status codes.
 */
export function openCode2FailureDetail(cause: unknown): string {
  return openCode2FailureDetailBounded(cause, 4);
}

function openCode2FailureDetailBounded(cause: unknown, depth: number): string {
  if (OpenCode2RuntimeError.is(cause)) {
    return cause.detail;
  }
  const tag = readTag(cause);
  switch (tag) {
    case "UnauthorizedError":
      return "OpenCode 2 server rejected authentication. Check the server URL and password.";
    case "SchemaError":
      return "OpenCode 2 server response did not match the pinned client schema. Server and client builds must use the same pinned prerelease.";
    case "SessionNotFoundError":
      return "OpenCode 2 session was not found.";
    case "ClientError": {
      // The generated client wraps transport/decoding failures. Unwrap the
      // cause (bounded) — never serialize it, it can carry the request.
      const nested = (cause as { readonly cause?: unknown }).cause;
      if (depth > 0 && nested !== undefined) {
        return openCode2FailureDetailBounded(nested, depth - 1);
      }
      return "OpenCode 2 request failed.";
    }
    case "HttpClientError":
    case "RequestError":
    case "ResponseError": {
      const record = cause as {
        readonly reason?: unknown;
        readonly response?: { readonly status?: unknown };
      };
      const status =
        record.response && typeof record.response === "object" ? record.response.status : undefined;
      if (status === 401 || status === 403) {
        return "OpenCode 2 server rejected authentication. Check the server URL and password.";
      }
      const reason = typeof record.reason === "string" ? record.reason : undefined;
      const parts = [
        "OpenCode 2 request failed",
        ...(reason ? [`(${reason})`] : []),
        ...(typeof status === "number" ? [`with status ${status}`] : []),
      ];
      return `${parts.join(" ")}.`;
    }
    default:
      break;
  }
  const message = readMessage(cause);
  if (tag && message) return `${tag}: ${message}`;
  if (message) return message;
  if (tag) return tag;
  if (typeof cause === "string" && cause.trim().length > 0) return cause.trim();
  return "OpenCode 2 request failed.";
}

/** Encode a small structured value for diagnostics; never used on causes. */
export function encodeJsonForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonString(input);
  return result._tag === "Success" ? result.value : undefined;
}

/**
 * Run one generated-client call, normalizing every typed failure into a
 * sanitized {@link OpenCode2RuntimeError}.
 */
export const runOpenCode2 = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, OpenCode2RuntimeError, R> =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new OpenCode2RuntimeError({
          operation,
          detail: openCode2FailureDetail(cause),
          cause,
        }),
    ),
    Effect.withSpan(`opencode2.${operation}`),
  );

/** Whether a failure definitively reports a missing OpenCode 2 session. */
export function isOpenCode2SessionNotFound(cause: unknown): boolean {
  if (OpenCode2RuntimeError.is(cause)) {
    return isOpenCode2SessionNotFound(cause.cause);
  }
  return readTag(cause) === "SessionNotFoundError";
}

export function buildOpenCode2BasicAuthorization(serverPassword: string): string {
  return `Basic ${Buffer.from(`opencode:${serverPassword}`, "utf8").toString("base64")}`;
}

/**
 * Build a generated Effect client bound to the configured external server.
 * Basic auth is installed as an `HttpClient` transform so the password
 * lives only in the transport layer and never in call sites or errors.
 */
export const makeOpenCode2Client = (input: {
  readonly serverUrl: string;
  readonly serverPassword?: string | undefined;
}): Effect.Effect<OpenCodeClient, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const base = yield* HttpClient.HttpClient;
    const authed = input.serverPassword
      ? HttpClient.mapRequest(
          base,
          HttpClientRequest.setHeader(
            "authorization",
            buildOpenCode2BasicAuthorization(input.serverPassword),
          ),
        )
      : base;
    return yield* OpenCode.make({ baseUrl: input.serverUrl }).pipe(
      Effect.provideService(HttpClient.HttpClient, authed),
    );
  });

export interface ParsedOpenCode2ModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

/** Parse T3's canonical `provider/model` slug. */
export function parseOpenCode2ModelSlug(
  slug: string | null | undefined,
): ParsedOpenCode2ModelSlug | null {
  if (typeof slug !== "string") return null;
  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}

/**
 * Stable T3 question id for one OpenCode question entry. Mirrors the
 * legacy provider's scheme so the Code UI's answer payloads keep working.
 */
export function openCode2QuestionId(
  index: number,
  question: Question.Request["questions"][number],
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`;
}

export function toOpenCode2PermissionReply(
  decision: ProviderApprovalDecision,
): "once" | "always" | "reject" {
  switch (decision) {
    case "accept":
      return "once";
    case "acceptForSession":
      return "always";
    case "decline":
    case "cancel":
    default:
      return "reject";
  }
}

/**
 * Convert T3 user-input answers back to OpenCode 2's positional answer
 * arrays. Accepts the generated question ids plus header/question text as
 * lookup keys, mirroring the legacy provider.
 */
export function toOpenCode2QuestionAnswers(
  request: Question.Request,
  answers: Record<string, unknown>,
): Array<ReadonlyArray<string>> {
  return request.questions.map((question, index) => {
    const raw =
      answers[openCode2QuestionId(index, question)] ??
      answers[question.header] ??
      answers[question.question];
    if (Array.isArray(raw)) {
      return raw.filter((value): value is string => typeof value === "string");
    }
    if (typeof raw === "string") {
      return raw.trim().length > 0 ? [raw] : [];
    }
    return [];
  });
}

const DATA_URI_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Encode one attachment as a `data:` URI prompt file. The OpenCode 2
 * server is remote; a `file://` path under T3's attachment store would not
 * be readable there, so the bytes travel inline.
 */
export function toOpenCode2DataUri(input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): string | null {
  if (input.bytes.byteLength > DATA_URI_MAX_BYTES) {
    return null;
  }
  return `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
}
