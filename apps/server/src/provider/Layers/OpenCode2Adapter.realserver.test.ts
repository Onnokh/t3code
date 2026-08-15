// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalFetch:off
// @effect-diagnostics globalTimers:off
// @effect-diagnostics globalConsole:off
// The harness below manages a real external `opencode2 serve` process and
// its install cache OUTSIDE the Effect runtime on purpose: the process must
// survive across individual Effect scopes and the setup runs in plain
// vitest lifecycle hooks.
/**
 * OpenCode 2 provider contract tests against a REAL pinned server.
 *
 * These tests install the exact pinned `@opencode-ai/cli` prerelease into
 * a temp cache (once per machine), start `opencode2 serve` with isolated
 * state, and drive the bounded provider end-to-end: inventory through the
 * v2 service contract, session create, streamed prompt, interrupt,
 * reconnect by resume cursor, sanitized auth failures, and workspace-root
 * containment.
 *
 * The prompt tests use the server's built-in free `opencode/*` models, so
 * a real model response streams without any account. If the pinned binary
 * cannot be fetched (offline machine) the suite skips with a clear reason
 * instead of failing; set OPENCODE2_REAL_SERVER=0 to skip explicitly.
 */
import * as NodeAssert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, beforeAll, describe, it } from "vite-plus/test";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";

import {
  OpenCode2Settings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as ServerConfig from "../../config.ts";
import * as Schema from "effect/Schema";
import { makeOpenCode2TextGeneration } from "../../textGeneration/OpenCode2TextGeneration.ts";
import { makeOpenCode2Adapter, type OpenCode2AdapterShape } from "./OpenCode2Adapter.ts";
import {
  checkOpenCode2ProviderStatus,
  flattenOpenCode2Models,
  loadOpenCode2Inventory,
} from "./OpenCode2Provider.ts";
import {
  buildOpenCode2BasicAuthorization,
  makeOpenCode2Client,
  OPENCODE2_PINNED_VERSION,
} from "../opencode2Runtime.ts";

const decodeSettings = Schema.decodeSync(OpenCode2Settings);
const INSTANCE_ID = ProviderInstanceId.make("opencode2");
const SETUP_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 240_000;

interface RealServer {
  readonly url: string;
  readonly password: string;
  readonly workspaceDir: string;
  readonly defaultModelSlug: string;
  readonly child: ChildProcess;
}

let unavailableReason: string | null = null;
let server: RealServer | null = null;
let tempRoot: string | null = null;

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = NodeNet.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const port = address.port;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error("no port")));
      }
    });
    probe.on("error", reject);
  });
}

/**
 * Install the exact pinned CLI into a per-machine temp cache. Tries npm
 * first, then bun. Returns the binary path or null with a reason.
 */
function ensurePinnedCli(): { readonly binary: string } | { readonly reason: string } {
  const cacheDir = NodePath.join(NodeOS.tmpdir(), `t3-opencode2-cli-${OPENCODE2_PINNED_VERSION}`);
  const binary = NodePath.join(cacheDir, "node_modules", ".bin", "opencode2");
  if (NodeFS.existsSync(binary)) {
    return { binary };
  }
  NodeFS.mkdirSync(cacheDir, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(cacheDir, "package.json"),
    JSON.stringify({ name: "t3-opencode2-cli-cache", private: true }),
  );
  const npmInstall = spawnSync(
    "npm",
    [
      "install",
      `@opencode-ai/cli@${OPENCODE2_PINNED_VERSION}`,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    { cwd: cacheDir, timeout: SETUP_TIMEOUT_MS, encoding: "utf8" },
  );
  if (NodeFS.existsSync(binary)) {
    return { binary };
  }
  const bunInstall = spawnSync(
    "bun",
    ["add", "--trust", `@opencode-ai/cli@${OPENCODE2_PINNED_VERSION}`],
    { cwd: cacheDir, timeout: SETUP_TIMEOUT_MS, encoding: "utf8" },
  );
  if (NodeFS.existsSync(binary)) {
    return { binary };
  }
  return {
    reason:
      `could not install @opencode-ai/cli@${OPENCODE2_PINNED_VERSION} ` +
      `(npm: ${npmInstall.status ?? npmInstall.error?.message ?? "?"}, ` +
      `bun: ${bunInstall.status ?? bunInstall.error?.message ?? "?"})`,
  };
}

async function waitForHealth(url: string, password: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${url}/api/health`, {
        headers: { authorization: buildOpenCode2BasicAuthorization(password) },
      });
      if (response.ok) {
        const body = (await response.json()) as { readonly version?: string };
        if (body.version === OPENCODE2_PINNED_VERSION) return;
        throw new Error(`unexpected server version ${body.version}`);
      }
    } catch (cause) {
      if (Date.now() > deadline) throw cause;
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for OpenCode 2 health");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  if (process.env.OPENCODE2_REAL_SERVER === "0") {
    unavailableReason = "OPENCODE2_REAL_SERVER=0";
    return;
  }
  const cli = ensurePinnedCli();
  if ("reason" in cli) {
    unavailableReason = cli.reason;
    // eslint-disable-next-line no-console
    console.warn(`[opencode2 real-server tests skipped] ${cli.reason}`);
    return;
  }
  tempRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "oc2-contract-"));
  const workspaceDir = NodePath.join(tempRoot, "workspaces", "code");
  const projectDir = NodePath.join(workspaceDir, "demo");
  NodeFS.mkdirSync(projectDir, { recursive: true });
  const home = NodePath.join(tempRoot, "home");
  NodeFS.mkdirSync(home, { recursive: true });
  const port = await findFreePort();
  const child = spawn(cli.binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: NodePath.join(home, ".config"),
      XDG_DATA_HOME: NodePath.join(home, ".local", "share"),
      XDG_STATE_HOME: NodePath.join(home, ".local", "state"),
      XDG_CACHE_HOME: NodePath.join(home, ".cache"),
      OPENCODE_CONFIG_CONTENT: "{}",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const url = `http://127.0.0.1:${port}`;
  const passwordDeadline = Date.now() + 60_000;
  let password: string | null = null;
  while (Date.now() < passwordDeadline) {
    const match = /server password (\S+)/.exec(stdout);
    if (match?.[1]) {
      password = match[1];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!password) {
    unavailableReason = `server did not print a password. stdout: ${stdout.slice(0, 500)}`;
    child.kill("SIGKILL");
    return;
  }
  await waitForHealth(url, password, 60_000);

  // Resolve the live default model once; prompt tests use it.
  const inventory = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeOpenCode2Client({ serverUrl: url, serverPassword: password });
      return yield* loadOpenCode2Inventory(client, workspaceDir);
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const defaultModelSlug = inventory.defaultModel
    ? `${inventory.defaultModel.providerID}/${inventory.defaultModel.modelID}`
    : (flattenOpenCode2Models(inventory)[0]?.slug ?? null);
  if (!defaultModelSlug) {
    unavailableReason = "pinned server reported no models";
    child.kill("SIGKILL");
    return;
  }
  server = { url, password, workspaceDir, defaultModelSlug, child };
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  server?.child.kill("SIGKILL");
  if (tempRoot) {
    NodeFS.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function requireServer(): RealServer | null {
  return server;
}

function testSettings(input?: {
  readonly password?: string;
  readonly workspaceRoot?: string;
}): OpenCode2Settings {
  const live = server;
  if (!live) throw new Error("real server unavailable");
  return decodeSettings({
    serverUrl: live.url,
    serverPassword: input?.password ?? live.password,
    workspaceRoot: input?.workspaceRoot ?? live.workspaceDir,
  });
}

const baseLayer = () =>
  Layer.mergeAll(
    NodeServices.layer,
    FetchHttpClient.layer,
    ServerConfig.layerTest(server?.workspaceDir ?? process.cwd(), {
      prefix: "oc2-contract",
    }).pipe(Layer.provide(NodeServices.layer)),
  );

class ContractTestTimeoutError extends Data.TaggedError("ContractTestTimeoutError")<{
  readonly label: string;
  readonly observed: string;
}> {}

const withAdapter = <A, E>(
  settings: OpenCode2Settings,
  use: (
    adapter: OpenCode2AdapterShape,
    collected: Array<ProviderRuntimeEvent>,
  ) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeOpenCode2Adapter(settings, { instanceId: INSTANCE_ID });
        const collected: Array<ProviderRuntimeEvent> = [];
        const pump = yield* adapter.streamEvents
          .pipe(Stream.runForEach((event) => Effect.sync(() => collected.push(event))))
          .pipe(Effect.forkScoped);
        const result = yield* use(adapter, collected);
        yield* Fiber.interrupt(pump).pipe(Effect.ignore);
        return result;
      }),
    ).pipe(Effect.provide(baseLayer())),
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

describe("OpenCode 2 provider contract (real pinned server)", () => {
  it(
    "serves inventory through the pinned v2 service contract",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const inventory = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* makeOpenCode2Client({
            serverUrl: live.url,
            serverPassword: live.password,
          });
          return yield* loadOpenCode2Inventory(client, live.workspaceDir);
        }).pipe(Effect.provide(FetchHttpClient.layer)),
      );
      NodeAssert.equal(inventory.serverVersion, OPENCODE2_PINNED_VERSION);
      NodeAssert.ok(inventory.models.length > 0);
      NodeAssert.ok(inventory.agents.some((agent: { id: string }) => agent.id === "build"));
      const models = flattenOpenCode2Models(inventory);
      NodeAssert.ok(models.length > 0);
      NodeAssert.ok(models.every((model) => model.slug.includes("/")));
      NodeAssert.ok(models.some((model) => model.isDefault === true));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports a ready provider snapshot with live models",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const snapshot = await Effect.runPromise(
        checkOpenCode2ProviderStatus(testSettings(), live.workspaceDir).pipe(
          Effect.provide(FetchHttpClient.layer),
        ),
      );
      NodeAssert.equal(snapshot.status, "ready");
      NodeAssert.equal(snapshot.version, OPENCODE2_PINNED_VERSION);
      NodeAssert.ok(snapshot.models.length > 0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "creates a session, streams a real model response, and completes the turn",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const threadId = ThreadId.make("oc2-contract-stream");
      await withAdapter(testSettings(), (adapter, collected) =>
        Effect.gen(function* () {
          const session = yield* adapter.startSession({
            threadId,
            runtimeMode: "full-access",
            cwd: NodePath.join(live.workspaceDir, "demo"),
          });
          NodeAssert.equal(session.provider, "opencode2");
          NodeAssert.equal(session.status, "ready");

          const turn = yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly the word pong.",
            modelSelection: { instanceId: INSTANCE_ID, model: live.defaultModelSlug },
          });
          NodeAssert.ok(turn.resumeCursor);

          yield* waitForEvent(
            collected,
            (event) => event.type === "turn.started",
            10_000,
            "turn.started",
          );
          yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" &&
              (event.payload as { state?: string }).state === "completed",
            180_000,
            "turn.completed",
          );
          const deltas = collected.filter(
            (event) =>
              event.type === "content.delta" &&
              (event.payload as { streamKind?: string }).streamKind === "assistant_text",
          );
          NodeAssert.ok(deltas.length > 0, "expected streamed assistant text");
          const completion = collected.find(
            (event) =>
              event.type === "item.completed" &&
              (event.payload as { itemType?: string }).itemType === "assistant_message",
          );
          NodeAssert.ok(completion, "expected assistant message completion");

          const thread = yield* adapter.readThread(threadId);
          NodeAssert.ok(thread.turns.length >= 1);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "interrupts an active turn and leaves the session usable",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const threadId = ThreadId.make("oc2-contract-interrupt");
      await withAdapter(testSettings(), (adapter, collected) =>
        Effect.gen(function* () {
          yield* adapter.startSession({
            threadId,
            runtimeMode: "full-access",
            cwd: NodePath.join(live.workspaceDir, "demo"),
          });
          yield* adapter.sendTurn({
            threadId,
            input: "Write an extremely long 3000 word story about turtles. Do not stop early.",
            modelSelection: { instanceId: INSTANCE_ID, model: live.defaultModelSlug },
          });
          // Wait until output is flowing so the interrupt hits mid-turn.
          yield* waitForEvent(
            collected,
            (event) => event.type === "content.delta",
            120_000,
            "first content.delta",
          );
          yield* adapter.interruptTurn(threadId);
          yield* waitForEvent(
            collected,
            (event) => event.type === "turn.aborted",
            30_000,
            "turn.aborted",
          );

          // The same session accepts a follow-up turn after the interrupt.
          const before = collected.length;
          const later: Array<ProviderRuntimeEvent> = collected;
          yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly the word pong.",
            modelSelection: { instanceId: INSTANCE_ID, model: live.defaultModelSlug },
          });
          yield* waitForEvent(
            later,
            (event) =>
              later.indexOf(event) >= before &&
              event.type === "turn.completed" &&
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
    "resumes the same server session from the durable cursor",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const threadId = ThreadId.make("oc2-contract-resume");
      const cwd = NodePath.join(live.workspaceDir, "demo");

      const firstRun = await withAdapter(testSettings(), (adapter, collected) =>
        Effect.gen(function* () {
          yield* adapter.startSession({ threadId, runtimeMode: "full-access", cwd });
          const started = yield* waitForEvent(
            collected,
            (event) => event.type === "thread.started",
            10_000,
            "thread.started",
          );
          const turn = yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly the word pong.",
            modelSelection: { instanceId: INSTANCE_ID, model: live.defaultModelSlug },
          });
          yield* waitForEvent(
            collected,
            (event) =>
              event.type === "turn.completed" &&
              (event.payload as { state?: string }).state === "completed",
            180_000,
            "turn.completed",
          );
          return {
            providerThreadId: (started.payload as { providerThreadId?: string }).providerThreadId,
            resumeCursor: turn.resumeCursor,
          };
        }),
      );
      NodeAssert.ok(firstRun.providerThreadId);
      NodeAssert.ok(firstRun.resumeCursor);

      // A fresh adapter (fresh process semantics) re-adopts the session.
      await withAdapter(testSettings(), (adapter, collected) =>
        Effect.gen(function* () {
          yield* adapter.startSession({
            threadId,
            runtimeMode: "full-access",
            cwd,
            resumeCursor: firstRun.resumeCursor,
          });
          const started = yield* waitForEvent(
            collected,
            (event) => event.type === "thread.started",
            10_000,
            "thread.started after resume",
          );
          NodeAssert.equal(
            (started.payload as { providerThreadId?: string }).providerThreadId,
            firstRun.providerThreadId,
          );
          const thread = yield* adapter.readThread(threadId);
          NodeAssert.ok(
            thread.turns.length >= 1,
            "resumed session must expose the earlier assistant turn",
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sanitizes authentication failures without leaking the password",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const threadId = ThreadId.make("oc2-contract-auth");
      const wrongPassword = "definitely-not-the-password";
      const outcome = await withAdapter(testSettings({ password: wrongPassword }), (adapter) =>
        Effect.gen(function* () {
          return yield* adapter
            .startSession({
              threadId,
              runtimeMode: "full-access",
              cwd: NodePath.join(live.workspaceDir, "demo"),
            })
            .pipe(Effect.flip);
        }),
      );
      const detail = (outcome as { detail?: string }).detail ?? String(outcome);
      NodeAssert.ok(detail.toLowerCase().includes("authentication"), detail);
      NodeAssert.ok(!detail.includes(wrongPassword));
      NodeAssert.ok(!detail.includes(live.password));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects session directories outside the Code Workspace Root",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const threadId = ThreadId.make("oc2-contract-root");
      const outcome = await withAdapter(testSettings(), (adapter) =>
        adapter
          .startSession({
            threadId,
            runtimeMode: "full-access",
            cwd: NodeOS.tmpdir(),
          })
          .pipe(Effect.flip),
      );
      NodeAssert.equal(
        (outcome as { _tag?: string })._tag,
        "ProviderAdapterValidationError",
        String(outcome),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "runs text generation through the stateless generate contract",
    async (ctx) => {
      const live = requireServer();
      if (!live) return ctx.skip();
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const textGeneration = yield* makeOpenCode2TextGeneration(testSettings());
          return yield* textGeneration
            .generateThreadTitle({
              cwd: NodePath.join(live.workspaceDir, "demo"),
              message: "Please add a health endpoint to the demo service",
              modelSelection: { instanceId: INSTANCE_ID, model: live.defaultModelSlug },
            })
            .pipe(Effect.result);
        }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
      );
      if (result._tag === "Success") {
        NodeAssert.ok(result.success.title.trim().length > 0);
      } else {
        // The free evaluation model may refuse strict JSON output; the
        // contract point proven here is that `generate.text` executed and
        // failures normalize into TextGenerationError, never a crash.
        NodeAssert.equal(result.failure._tag, "TextGenerationError");
        NodeAssert.ok(
          ["invalid structured output", "empty output"].some((needle) =>
            String(result.failure.detail).includes(needle),
          ),
          String(result.failure.detail),
        );
      }
    },
    TEST_TIMEOUT_MS,
  );
});
