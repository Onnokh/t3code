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

# git: checkpointing and project management. Build tools: node-pty.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

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

ENV TZ=Europe/Amsterdam \
    NODE_ENV=production \
    T3CODE_HOME=/data/t3

# /data/t3: T3 sessions, config, and project metadata (owner: T3 only).
# /data/claude: Claude Max login and Agent SDK state (owner: T3 only).
# /workspaces/code: the Code Workspace Root, shared with interactive
# OpenCode 2 at the identical absolute path.
VOLUME /data/t3
VOLUME /data/claude
VOLUME /workspaces/code

EXPOSE 3773

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3773/.well-known/t3/environment').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# `serve` runs headless and prints one-time pairing details to the log on
# first boot. Mint later pairing credentials with:
#   node apps/server/src/bin.ts pair --base-dir /data/t3
CMD ["node", "apps/server/src/bin.ts", "serve", "--host", "0.0.0.0", "--port", "3773", "--base-dir", "/data/t3"]
