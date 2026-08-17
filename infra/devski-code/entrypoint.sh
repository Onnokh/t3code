#!/bin/sh
# devski-code entrypoint — deployment-owned defaults, then the server.
#
# This container has a Code Workspace Root fixed by the deployment topology:
# /workspaces/code, the one path this container and the interactive OpenCode
# sidecar both mount at the same absolute path. T3 itself has no opinion about
# it, so without a default the Add Project screen proposes `~/<name>` — /root
# here — which the sidecar cannot see at all, and `startSession` then rejects
# the thread for resolving outside the root.
#
# Seeding the setting is deliberately one-way: an owner who picks a different
# folder in settings keeps it, because only an absent or empty value is filled.
set -e

BASE_DIR="${T3CODE_HOME:-/data/t3}"
# `stateDir` is `<base-dir>/userdata` for an explicit --base-dir; see
# deriveServerPaths in apps/server/src/config.ts.
SETTINGS_PATH="${BASE_DIR}/userdata/settings.json"
PROJECT_ROOT="${T3CODE_ADD_PROJECT_BASE_DIR:-/workspaces/code}"

mkdir -p "$(dirname "$SETTINGS_PATH")" "$PROJECT_ROOT"

SETTINGS_PATH="$SETTINGS_PATH" PROJECT_ROOT="$PROJECT_ROOT" node -e '
const { readFileSync, writeFileSync, renameSync } = require("node:fs");
const settingsPath = process.env.SETTINGS_PATH;
const projectRoot = process.env.PROJECT_ROOT;

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

const current =
  typeof settings.addProjectBaseDirectory === "string"
    ? settings.addProjectBaseDirectory.trim()
    : "";
if (current.length > 0) process.exit(0);

settings.addProjectBaseDirectory = projectRoot;
const temporaryPath = `${settingsPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`);
renameSync(temporaryPath, settingsPath);
console.log(`[devski-code] new projects default to ${projectRoot}`);
'

exec "$@"
