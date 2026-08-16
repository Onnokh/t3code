# devski-code — the private T3 environment behind the Devski Gateway.
#
# Build from the repository root:
#
#   docker build -f infra/devski-code/Dockerfile -t devski-code .
#
# The container is private: the Devski Gateway is its only client and reaches
# it over the internal network (topology default http://devski-t3:3773). It is
# never published on a public domain. See infra/devski-code/README.md.
FROM node:24.13.1-bookworm-slim

# Pinned Claude Code runtime — the executable T3's Claude Agent SDK driver
# spawns (default `binaryPath` is `claude`). This ARG is the single source of
# truth for the deployed Claude runtime version; a test in
# apps/server/src/provider/Drivers/ClaudeRuntimePin.test.ts keeps it at or
# above the minimum the model catalog requires. Bump it here in a reviewed
# change — the running container never self-updates (DISABLE_AUTOUPDATER).
ARG CLAUDE_CODE_VERSION=2.1.231

# git: checkpointing and project management. Build tools: node-pty.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

RUN npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && claude --version

WORKDIR /srv/t3code

# Workspace manifests first so dependency installation caches independently
# from source changes. The root `prepare` script needs `scripts/`, `t3.json`,
# and `vite.config.ts`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json t3.json vite.config.ts ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages
COPY apps/server ./apps/server

# Install only the server package and its workspace dependencies.
RUN pnpm install --frozen-lockfile --filter t3...

# CLAUDE_CONFIG_DIR keeps the Claude Max login (`.credentials.json`),
# `.claude.json`, and all Agent SDK state on the /data/claude volume so
# authentication survives restarts and redeploys. T3's Claude driver passes
# the process environment through to every spawned Claude runtime when the
# instance has no custom `homePath` (see makeClaudeEnvironment in
# apps/server/src/provider/Drivers/ClaudeHome.ts), so the default provider
# instance persists there without any settings change.
# DEVSKI_CLAUDE_CODE_VERSION lets claude-runtime-smoke.mjs verify the pin at
# runtime; DISABLE_AUTOUPDATER stops the CLI from drifting off it.
# IS_SANDBOX: the container is the sandbox boundary; without it Claude Code
# refuses bypassPermissions ("Full" access mode) for the root user and every
# Full-mode turn fails at turn/setPermissionMode.
ENV TZ=Europe/Amsterdam \
    NODE_ENV=production \
    T3CODE_HOME=/data/t3 \
    CLAUDE_CONFIG_DIR=/data/claude \
    DEVSKI_CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION} \
    DISABLE_AUTOUPDATER=1 \
    IS_SANDBOX=1

# In-container deployment smoke: pinned Claude runtime + /data/claude
# persistence and permissions. Run it with:
#   docker exec <container> node infra/devski-code/claude-runtime-smoke.mjs
COPY infra/devski-code/claude-runtime-smoke.mjs ./infra/devski-code/claude-runtime-smoke.mjs

# /data/t3: T3 sessions, config, and project metadata (owner: T3 only).
# /data/claude: Claude Max login and Agent SDK state (owner: T3 only).
# /workspaces/code: the Code Workspace Root, shared with interactive
# OpenCode 2 at the identical absolute path.
RUN mkdir -p /data/t3 /data/claude /workspaces/code
VOLUME /data/t3
VOLUME /data/claude
VOLUME /workspaces/code

EXPOSE 3773

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3773/.well-known/t3/environment').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# `serve` runs headless and prints one-shot pairing details to the log on
# first boot. Mint later pairing credentials with the auth control plane —
# `t3 pair` discovers servers through a runtime-state file this deployment does
# not have (see infra/devski-code/README.md):
#   node apps/server/src/bin.ts auth pairing create --base-dir /data/t3 --label iphone
CMD ["node", "apps/server/src/bin.ts", "serve", "--host", "0.0.0.0", "--port", "3773", "--base-dir", "/data/t3"]
