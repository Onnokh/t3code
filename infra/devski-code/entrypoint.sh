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

exec "$@"
