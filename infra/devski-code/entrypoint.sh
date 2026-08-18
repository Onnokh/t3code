#!/bin/sh
# devski-code entrypoint — deployment-owned defaults, then the server.
#
# This container has facts T3 cannot infer and no way for anyone to enter: the
# deployed image serves no web UI, and the mobile app has no settings surface
# for them. Anything the deployment knows has to be seeded here or configured
# by hand on the volume, which is how it was done before this file existed.
#
# Seeding is one-way. Only an absent or empty value is filled, so an owner who
# changes either setting keeps their choice across restarts and redeployments.
set -e

BASE_DIR="${T3CODE_HOME:-/data/t3}"
# `stateDir` is `<base-dir>/userdata` for an explicit --base-dir; see
# deriveServerPaths in apps/server/src/config.ts.
SETTINGS_PATH="${BASE_DIR}/userdata/settings.json"
PROJECT_ROOT="${T3CODE_ADD_PROJECT_BASE_DIR:-/workspaces/code}"
OPENCODE2_SERVER_URL="${T3CODE_OPENCODE2_SERVER_URL:-http://devski-opencode:4096}"

mkdir -p "$(dirname "$SETTINGS_PATH")" "$PROJECT_ROOT"

SETTINGS_PATH="$SETTINGS_PATH" \
PROJECT_ROOT="$PROJECT_ROOT" \
OPENCODE2_SERVER_URL="$OPENCODE2_SERVER_URL" \
node -e '
const { readFileSync, writeFileSync, renameSync } = require("node:fs");
const settingsPath = process.env.SETTINGS_PATH;
const projectRoot = process.env.PROJECT_ROOT;
const opencode2ServerUrl = process.env.OPENCODE2_SERVER_URL;
const opencode2Password = process.env.OPENCODE_SERVER_PASSWORD;

let settings = {};
try {
  const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  // A corrupt or non-object file is left alone: the server reports its own
  // parse warning and falls back to defaults, which is better than a silent
  // overwrite of something the owner may still want to recover.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) process.exit(0);
  settings = parsed;
} catch (cause) {
  if (cause.code !== "ENOENT") process.exit(0);
}

const announced = [];

const currentProjectRoot =
  typeof settings.addProjectBaseDirectory === "string"
    ? settings.addProjectBaseDirectory.trim()
    : "";
if (currentProjectRoot.length === 0) {
  settings.addProjectBaseDirectory = projectRoot;
  announced.push(`new projects default to ${projectRoot}`);
}

// The opencode2 driver is external-server only: with no serverUrl it reports
// a warning and the Code area has no OpenCode runtime. The sidecar address is
// a deployment constant, but the password is a secret, so this seeds the pair
// only when the password is actually in the environment.
const providers = typeof settings.providers === "object" && settings.providers !== null
  ? settings.providers
  : {};
const currentOpenCode2 = typeof providers.opencode2 === "object" && providers.opencode2 !== null
  ? providers.opencode2
  : {};
const hasServerUrl =
  typeof currentOpenCode2.serverUrl === "string" && currentOpenCode2.serverUrl.trim().length > 0;
if (!hasServerUrl && typeof opencode2Password === "string" && opencode2Password.length > 0) {
  settings.providers = {
    ...providers,
    opencode2: {
      ...currentOpenCode2,
      serverUrl: opencode2ServerUrl,
      serverPassword: opencode2Password,
      workspaceRoot: projectRoot,
    },
  };
  // The address, never the password.
  announced.push(`opencode2 points at ${opencode2ServerUrl}`);
}

if (announced.length === 0) process.exit(0);

const temporaryPath = `${settingsPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
renameSync(temporaryPath, settingsPath);
for (const line of announced) console.log(`[devski-code] ${line}`);
'

# --- What the Claude runtime can reach -----------------------------------
#
# Unlike the settings above, this is not a one-way seed: agent-tools.json is the
# deployment's declaration and wins on every boot. Skills and MCP servers are not
# owner preferences a redeploy should preserve — they are the single answer to
# "what can an agent here reach", and keeping it in the image is what stops it
# drifting. The OpenCode 2 sidecar renders its own config from the same file.
#
# It has to run here rather than in the image because CLAUDE_CONFIG_DIR is a
# volume, and a mount masks whatever the image put below it.
AGENT_TOOLS="${DEVSKI_AGENT_TOOLS:-/etc/devski/agent-tools.json}"

if [ -f "$AGENT_TOOLS" ]; then
  AGENT_TOOLS="$AGENT_TOOLS" CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-/data/claude}" node -e '
const { readFileSync, mkdirSync, symlinkSync, rmSync, existsSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const declaration = JSON.parse(readFileSync(process.env.AGENT_TOOLS, "utf8"));
const claudeDir = process.env.CLAUDE_DIR;
mkdirSync(claudeDir, { recursive: true });

// Skills: a link, not a copy, so the image stays the only source and a redeploy
// is what moves them. Claude Code reads its user skills below CLAUDE_CONFIG_DIR.
const [library] = declaration.skills ?? [];
if (typeof library === "string" && existsSync(library)) {
  const link = join(claudeDir, "skills");
  try {
    rmSync(link, { recursive: true, force: true });
    symlinkSync(library, link);
    console.log(`[devski-code] claude skills -> ${library}`);
  } catch (cause) {
    console.log(`[devski-code] claude skills could not be linked: ${cause.message}`);
  }
}

// {env:VAR} keeps every credential out of the image and out of this file. A
// server whose credential is not in the environment is left undeclared: a
// registered server with an empty bearer answers 401 on every call inside a
// session, which is a worse failure than not being there.
const resolve = (value) => String(value).replace(/\{env:([A-Za-z0-9_]+)\}/g, (_, name) => process.env[name] ?? "");
const unresolved = (value) => /\{env:[A-Za-z0-9_]+\}/.test(String(value));

for (const [name, server] of Object.entries(declaration.mcpServers ?? {})) {
  const headers = Object.entries(server.headers ?? {}).map(([key, value]) => [key, resolve(value)]);
  const incomplete = headers.some(([, value]) => unresolved(value) || value.replace(/^Bearer\s*/i, "").trim() === "");
  // Removed unconditionally, and before the credential check. An edited URL or a
  // rotated token has to actually move, and a boot without the credential must
  // not leave the server from an earlier boot behind: Claude stores the resolved
  // bearer in its user scope on the volume, so a stale entry would keep working
  // and outlive the declaration that is supposed to be the only answer.
  spawnSync("claude", ["mcp", "remove", "--scope", "user", name], { stdio: "ignore" });
  if (incomplete) {
    console.log(`[devski-code] mcp ${name} not declared: its credential is absent from the environment`);
    continue;
  }
  const args = ["mcp", "add", "--scope", "user", name, "--transport", server.type ?? "http", server.url];
  for (const [key, value] of headers) args.push("--header", `${key}: ${value}`);
  const added = spawnSync("claude", args, { stdio: "ignore" });
  // Only whether it was written. `claude mcp add` does print a health line, but
  // asynchronously and not on this handle, so reading health from here reported
  // a working server as unreachable. `claude mcp list` is where health lives.
  console.log(added.status === 0
    ? `[devski-code] mcp ${name} -> ${server.url}`
    : `[devski-code] mcp ${name} could not be declared`);
}
' || echo "[devski-code] agent tools could not be applied"
fi

exec "$@"
