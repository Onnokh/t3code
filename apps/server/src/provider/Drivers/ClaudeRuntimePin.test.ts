// @effect-diagnostics nodeBuiltinImport:off
/**
 * Deployment contract for the devski-code Claude runtime (PLO-415).
 *
 * The private T3 image (infra/devski-code/Dockerfile) must:
 *   - pin one exact `@anthropic-ai/claude-code` version that serves the
 *     complete built-in model catalog;
 *   - keep Claude Max login and Agent SDK state on the persistent
 *     /data/claude volume through CLAUDE_CONFIG_DIR;
 *   - disable the CLI auto-updater so the running container never drifts
 *     off the pinned version;
 *   - ship the in-container runtime smoke next to the server.
 *
 * These tests read the Dockerfile so a pin or persistence regression fails
 * in CI instead of on the deployed box.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, it } from "vite-plus/test";

import { compareSemverVersions } from "@t3tools/shared/semver";

import { MINIMUM_CLAUDE_OPUS_5_VERSION } from "../Layers/ClaudeProvider.ts";

const infraDir = NodePath.resolve(import.meta.dirname, "../../../../../infra/devski-code");
const dockerfilePath = NodePath.join(infraDir, "Dockerfile");
const dockerfile = NodeFS.readFileSync(dockerfilePath, "utf8");

function readPinnedClaudeVersion(): string {
  const match = /^ARG CLAUDE_CODE_VERSION=(\S+)$/m.exec(dockerfile);
  NodeAssert.ok(match?.[1], "infra/devski-code/Dockerfile must declare ARG CLAUDE_CODE_VERSION");
  return match[1];
}

describe("devski-code Claude runtime pin", () => {
  it("pins one exact Claude Code version", () => {
    const pinned = readPinnedClaudeVersion();
    NodeAssert.match(
      pinned,
      /^\d+\.\d+\.\d+$/,
      `CLAUDE_CODE_VERSION must be an exact release version, got "${pinned}"`,
    );
    NodeAssert.match(
      dockerfile,
      /npm install -g[^\n]*@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/,
      "the image must install @anthropic-ai/claude-code at the pinned ARG",
    );
  });

  it("keeps the pin new enough for the complete built-in model catalog", () => {
    const pinned = readPinnedClaudeVersion();
    NodeAssert.ok(
      compareSemverVersions(pinned, MINIMUM_CLAUDE_OPUS_5_VERSION) >= 0,
      `CLAUDE_CODE_VERSION ${pinned} is older than the newest model gate ` +
        `${MINIMUM_CLAUDE_OPUS_5_VERSION}; the deployed runtime would hide catalog models`,
    );
  });

  it("persists Claude auth state on the /data/claude volume", () => {
    NodeAssert.match(
      dockerfile,
      /CLAUDE_CONFIG_DIR=\/data\/claude/,
      "CLAUDE_CONFIG_DIR must point at the persistent /data/claude volume",
    );
    NodeAssert.match(
      dockerfile,
      /^VOLUME \/data\/claude$/m,
      "/data/claude must be a declared volume",
    );
  });

  it("never self-updates off the pin and exposes it to the runtime smoke", () => {
    NodeAssert.match(dockerfile, /DISABLE_AUTOUPDATER=1/);
    NodeAssert.match(dockerfile, /DEVSKI_CLAUDE_CODE_VERSION=\$\{CLAUDE_CODE_VERSION\}/);
  });

  it("ships the in-container Claude runtime smoke", () => {
    NodeAssert.match(dockerfile, /COPY infra\/devski-code\/claude-runtime-smoke\.mjs/);
    NodeAssert.ok(
      NodeFS.existsSync(NodePath.join(infraDir, "claude-runtime-smoke.mjs")),
      "infra/devski-code/claude-runtime-smoke.mjs must exist",
    );
  });
});
