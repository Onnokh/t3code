// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalConsole:off
/**
 * Claude Agent SDK provider contract tests against the REAL Claude runtime
 * (PLO-415).
 *
 * These tests drive T3's Claude adapter end-to-end through the same code
 * path Devski's Code Area uses: session start, streamed prompt, interrupt,
 * and resume from the durable cursor — against the machine's existing
 * Claude login (the same server-persistent state the deployed devski-code
 * container keeps under CLAUDE_CONFIG_DIR=/data/claude).
 *
 * They consume real account usage, so they are strictly opt-in:
 *
 *   CLAUDE_REAL_SERVER=1 pnpm exec vp test run \
 *     src/provider/Layers/ClaudeAdapter.realserver.test.ts
 *
 * Without CLAUDE_REAL_SERVER=1, or without an authenticated `claude` on
 * PATH (or via CLAUDE_CONFIG_DIR), the suite skips with a clear reason.
 */
import * as NodeAssert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, beforeAll, describe, it } from "vite-plus/test";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ClaudeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { makeClaudeAdapter } from "./ClaudeAdapter.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);
const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const PROVIDER = ProviderDriverKind.make("claudeAgent");
const TEST_MODEL = "claude-haiku-4-5";
const TEST_TIMEOUT_MS = 240_000;

let unavailableReason: string | null = null;
let workspaceDir: string | null = null;
let tempRoot: string | null = null;

beforeAll(() => {
  if (process.env.CLAUDE_REAL_SERVER !== "1") {
    unavailableReason = "CLAUDE_REAL_SERVER is not 1 (real-account tests are opt-in)";
    return;
  }
  const status = spawnSync("claude", ["auth", "status"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (status.error || status.status !== 0) {
    unavailableReason = `\`claude auth status\` failed: ${
      status.error?.message ?? `exit ${status.status}`
    }`;
    console.warn(`[claude real-server tests skipped] ${unavailableReason}`);
    return;
  }
  try {
    const parsed = JSON.parse(status.stdout) as { readonly loggedIn?: boolean };
    if (parsed.loggedIn !== true) {
      unavailableReason = "the local Claude runtime is not logged in";
      console.warn(`[claude real-server tests skipped] ${unavailableReason}`);
      return;
    }
  } catch {
    unavailableReason = "`claude auth status` did not answer with JSON";
    console.warn(`[claude real-server tests skipped] ${unavailableReason}`);
    return;
  }
  tempRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-contract-"));
  workspaceDir = NodePath.join(tempRoot, "workspace");
  NodeFS.mkdirSync(workspaceDir, { recursive: true });
});

afterAll(() => {
  if (tempRoot) {
    NodeFS.rmSync(tempRoot, { recursive: true, force: true });
  }
});

class ContractTestTimeoutError extends Data.TaggedError("ContractTestTimeoutError")<{
  readonly label: string;
  readonly observed: string;
}> {}

const baseLayer = (cwd: string) =>
  ServerConfig.layerTest(cwd, tempRoot ?? NodeOS.tmpdir()).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  );

const withAdapter = <A, E>(
  cwd: string,
  use: (adapter: ClaudeAdapterShape, collected: Array<ProviderRuntimeEvent>) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeClaudeAdapter(decodeClaudeSettings({}), {
          instanceId: INSTANCE_ID,
        });
        const collected: Array<ProviderRuntimeEvent> = [];
        const pump = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => collected.push(event))),
          Effect.forkScoped,
        );
        const result = yield* use(adapter, collected);
        yield* adapter.stopAll().pipe(Effect.ignore);
        yield* Fiber.interrupt(pump).pipe(Effect.ignore);
        return result;
      }),
    ).pipe(Effect.provide(baseLayer(cwd))),
  );

const waitForEvent = (
  collected: ReadonlyArray<ProviderRuntimeEvent>,
  predicate: (event: ProviderRuntimeEvent) => boolean,
  timeoutMs: number,
  label: string,
): Effect.Effect<ProviderRuntimeEvent, ContractTestTimeoutError> =>
  Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
    for (;;) {
      const match = collected.find(predicate);
      if (match) return match;
      if ((yield* Clock.currentTimeMillis) > deadline) {
        return yield* new ContractTestTimeoutError({
          label,
          observed: collected.map((event) => event.type).join(", "),
        });
      }
      yield* Effect.sleep("150 millis");
    }
  });

function assistantText(collected: ReadonlyArray<ProviderRuntimeEvent>): string {
  return collected
    .filter(
      (event) =>
        event.type === "content.delta" &&
        (event.payload as { streamKind?: string }).streamKind !== "reasoning_text",
    )
    .map((event) => String((event.payload as { delta?: string }).delta ?? ""))
    .join("");
}

const modelSelection = () => createModelSelection(INSTANCE_ID, TEST_MODEL, []);

describe("Claude provider contract (real runtime)", () => {
  it(
    "creates a session, streams a real model response, and completes the turn",
    async (ctx) => {
      if (unavailableReason || !workspaceDir) return ctx.skip();
      const cwd = workspaceDir;
      const threadId = ThreadId.make("claude-contract-stream");
      await withAdapter(cwd, (adapter, collected) =>
        Effect.gen(function* () {
          const session = yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            modelSelection: modelSelection(),
            runtimeMode: "full-access",
            cwd,
          });
          NodeAssert.equal(session.provider, PROVIDER);

          const turn = yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly the word pong.",
            attachments: [],
            modelSelection: modelSelection(),
          });
          yield* waitForEvent(
            collected,
            (event) => event.type === "turn.started",
            30_000,
            "turn.started",
          );
          yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" &&
              String(event.turnId) === String(turn.turnId) &&
              (event.payload as { state?: string }).state === "completed",
            180_000,
            "turn.completed",
          );
          NodeAssert.ok(
            assistantText(collected).toLowerCase().includes("pong"),
            "expected streamed assistant text to contain the requested word",
          );

          const thread = yield* adapter.readThread(threadId);
          NodeAssert.ok(thread.turns.length >= 1);

          const sessions = yield* adapter.listSessions();
          const cursor = sessions.find(
            (candidate) => String(candidate.threadId) === String(threadId),
          )?.resumeCursor as { resume?: string } | undefined;
          NodeAssert.ok(
            typeof cursor?.resume === "string" && cursor.resume.length > 0,
            "expected a durable Claude resume id after the first completed turn",
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "interrupts an active turn and leaves the session usable",
    async (ctx) => {
      if (unavailableReason || !workspaceDir) return ctx.skip();
      const cwd = workspaceDir;
      const threadId = ThreadId.make("claude-contract-interrupt");
      await withAdapter(cwd, (adapter, collected) =>
        Effect.gen(function* () {
          yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            modelSelection: modelSelection(),
            runtimeMode: "full-access",
            cwd,
          });
          const longTurn = yield* adapter.sendTurn({
            threadId,
            input: "Write an extremely long 3000 word story about turtles. Do not stop early.",
            attachments: [],
            modelSelection: modelSelection(),
          });
          // Wait until output is flowing so the interrupt hits mid-turn.
          yield* waitForEvent(
            collected,
            (event) => event.type === "content.delta",
            120_000,
            "first content.delta",
          );
          yield* adapter.interruptTurn(threadId);
          const ended = yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" && String(event.turnId) === String(longTurn.turnId),
            60_000,
            "interrupted turn.completed",
          );
          const state = (ended.payload as { state?: string }).state;
          NodeAssert.notEqual(
            state,
            "completed",
            `interrupt must not complete the turn (${state})`,
          );

          // The same session accepts a follow-up turn after the interrupt.
          const followUp = yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly the word pong.",
            attachments: [],
            modelSelection: modelSelection(),
          });
          yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" &&
              String(event.turnId) === String(followUp.turnId) &&
              (event.payload as { state?: string }).state === "completed",
            180_000,
            "post-interrupt turn.completed",
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "resumes the same conversation from the durable cursor",
    async (ctx) => {
      if (unavailableReason || !workspaceDir) return ctx.skip();
      const cwd = workspaceDir;
      const threadId = ThreadId.make("claude-contract-resume");

      const firstRun = await withAdapter(cwd, (adapter, collected) =>
        Effect.gen(function* () {
          yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            modelSelection: modelSelection(),
            runtimeMode: "full-access",
            cwd,
          });
          const turn = yield* adapter.sendTurn({
            threadId,
            input: "Remember the code word aubergine. Reply with exactly the word stored.",
            attachments: [],
            modelSelection: modelSelection(),
          });
          yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" &&
              String(event.turnId) === String(turn.turnId) &&
              (event.payload as { state?: string }).state === "completed",
            180_000,
            "turn.completed",
          );
          const sessions = yield* adapter.listSessions();
          return sessions.find((candidate) => String(candidate.threadId) === String(threadId))
            ?.resumeCursor;
        }),
      );
      NodeAssert.ok(firstRun, "expected a resume cursor from the first adapter");

      // A fresh adapter (fresh process semantics — exactly what a container
      // restart produces) re-adopts the conversation from the cursor.
      await withAdapter(cwd, (adapter, collected) =>
        Effect.gen(function* () {
          yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            modelSelection: modelSelection(),
            runtimeMode: "full-access",
            cwd,
            resumeCursor: firstRun,
          });
          const turn = yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly the code word you were asked to remember.",
            attachments: [],
            modelSelection: modelSelection(),
          });
          yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" &&
              String(event.turnId) === String(turn.turnId) &&
              (event.payload as { state?: string }).state === "completed",
            180_000,
            "resumed turn.completed",
          );
          NodeAssert.ok(
            assistantText(collected).toLowerCase().includes("aubergine"),
            "the resumed session must remember the earlier conversation",
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
