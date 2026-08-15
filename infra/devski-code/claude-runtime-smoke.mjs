#!/usr/bin/env node
/**
 * devski-code Claude runtime smoke — run INSIDE the T3 container.
 *
 * Verifies the deployment invariants behind persistent Claude Max
 * authentication (PLO-415):
 *
 *   1. the pinned Claude runtime is installed and reports the exact
 *      version baked into the image (DEVSKI_CLAUDE_CODE_VERSION);
 *   2. CLAUDE_CONFIG_DIR points at the persistent volume and the service
 *      user can write to it;
 *   3. (--require-auth) Claude authentication state exists there, which is
 *      what must survive a container restart or redeploy.
 *
 * Usage:
 *   docker exec <container> node infra/devski-code/claude-runtime-smoke.mjs
 *   docker exec <container> node infra/devski-code/claude-runtime-smoke.mjs --require-auth
 *
 * Exit code 0 when every check passes, 1 otherwise. The script prints no
 * credential material — only file names and permission bits.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const requireAuth = process.argv.includes("--require-auth");
let failures = 0;

function pass(step, detail) {
  console.log(`PASS  ${step} — ${detail}`);
}

function fail(step, detail) {
  failures += 1;
  console.error(`FAIL  ${step} — ${detail}`);
}

// 1. Pinned Claude runtime.
const expectedVersion = (process.env.DEVSKI_CLAUDE_CODE_VERSION ?? "").trim();
if (!expectedVersion) {
  fail("claude-pin", "DEVSKI_CLAUDE_CODE_VERSION is not set in this container");
} else {
  try {
    const reported = NodeChildProcess.execFileSync("claude", ["--version"], {
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
    const match = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(reported);
    if (match && match[0] === expectedVersion) {
      pass("claude-pin", `claude --version reports the pinned ${expectedVersion}`);
    } else {
      fail(
        "claude-pin",
        `claude --version reports "${reported}" but the image pins ${expectedVersion}`,
      );
    }
  } catch (error) {
    fail("claude-pin", `claude --version failed: ${String(error?.message ?? error)}`);
  }
}

if (process.env.DISABLE_AUTOUPDATER === "1") {
  pass("claude-autoupdate", "DISABLE_AUTOUPDATER=1 keeps the runtime on the pin");
} else {
  fail("claude-autoupdate", "DISABLE_AUTOUPDATER is not 1; the runtime can drift off the pin");
}

// 2. Persistent Claude state directory.
const configDir = (process.env.CLAUDE_CONFIG_DIR ?? "").trim();
if (!configDir) {
  fail("claude-state-dir", "CLAUDE_CONFIG_DIR is not set; login state would land in HOME");
} else {
  pass("claude-state-dir", `CLAUDE_CONFIG_DIR=${configDir}`);
  try {
    const stat = NodeFS.statSync(configDir);
    if (!stat.isDirectory()) throw new Error("not a directory");
    const probe = NodePath.join(configDir, `.devski-smoke-${process.pid}`);
    NodeFS.writeFileSync(probe, "ok\n");
    NodeFS.rmSync(probe);
    pass(
      "claude-state-writable",
      `${configDir} is writable by uid=${process.getuid?.() ?? "?"} (mode ${(stat.mode & 0o777).toString(8)})`,
    );
  } catch (error) {
    fail("claude-state-writable", `${configDir}: ${String(error?.message ?? error)}`);
  }

  // 3. Authentication state. `.credentials.json` holds the Max OAuth state on
  // Linux; `.claude.json` holds the runtime's onboarding/config state.
  const stateFiles = [".credentials.json", ".claude.json"].filter((name) =>
    NodeFS.existsSync(NodePath.join(configDir, name)),
  );
  if (stateFiles.length > 0) {
    pass("claude-auth-state", `found ${stateFiles.join(", ")} in ${configDir}`);
  } else if (requireAuth) {
    fail(
      "claude-auth-state",
      `no .credentials.json or .claude.json in ${configDir}; run the one-time login (see infra/devski-code/README.md)`,
    );
  } else {
    console.log(
      `note: no auth state in ${configDir} yet — the one-time Max login has not run (pass --require-auth to enforce it)`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Claude runtime checks passed");
