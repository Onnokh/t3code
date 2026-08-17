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

# git: checkpointing and project management. curl: fetching the source-control
# CLIs below. Build tools: node-pty.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl openssh-client python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

# Source-control CLIs, matching the Digital Home Harness tool-belt. Agents
# reach for them directly, and T3's own change-request code shells out to both
# (GitHubPullRequestCli, GitLabPullRequestCli) — without them that surface
# fails with its "not installed" readiness hint. `glab` publishes no apt
# repository, so its release .deb is pinned at the Harness version.
ARG GLAB_VERSION=1.108.0
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && curl -fsSL -o /tmp/glab.deb "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_$(dpkg --print-architecture).deb" \
 && apt-get install -y /tmp/glab.deb && rm /tmp/glab.deb \
 && rm -rf /var/lib/apt/lists/* \
 && gh --version && glab --version

# `glab` posts telemetry and checks for a newer release on every invocation.
# As a git credential helper it runs on every fetch and push, so both become a
# network round-trip in the critical path. Declared as environment rather than
# `glab config set`, which would write under a path a volume can mask.
ENV GLAB_SEND_TELEMETRY=0 \
    GLAB_CHECK_UPDATE=0

# Make a plain `git clone` of a private repository work with no token in the
# URL and no interactive login. Each helper resolves the credential from
# GH_TOKEN / GITLAB_TOKEN at call time, so the image holds no secret; this is
# what `gh auth setup-git` writes, made explicit because that command needs an
# authenticated host at build time and this build has none. Self-hosted GitLab
# needs its own key, so GITLAB_HOST is honoured when it is not gitlab.com.
ARG GITLAB_HOST=gitlab.com
RUN git config --system credential."https://github.com".helper '!gh auth git-credential' \
 && git config --system credential."https://gitlab.com".helper '!glab auth git-credential' \
 && if [ "${GITLAB_HOST}" != "gitlab.com" ]; then \
      git config --system credential."https://${GITLAB_HOST}".helper '!glab auth git-credential'; \
    fi

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
# T3CODE_WORKTREES_DIR moves worktrees off the T3-only /data/t3 volume and into
# the Code Workspace Root. The interactive OpenCode 2 sidecar is a separate
# container that mounts only /workspaces/code, so a worktree below T3 home is
# invisible to it and `startSession` rejects the thread for resolving outside
# the root. Both containers see this path identically.
# T3CODE_ENVIRONMENT_LABEL is the name clients show for this environment. A
# container has no friendly host name, so without it the label falls back to
# the container ID and the app displays something like `9ccba90992fe`.
ENV TZ=Europe/Amsterdam \
    NODE_ENV=production \
    T3CODE_HOME=/data/t3 \
    T3CODE_ENVIRONMENT_LABEL=Devski \
    T3CODE_WORKTREES_DIR=/workspaces/code/.worktrees \
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

# The entrypoint seeds deployment-owned defaults that T3 itself cannot know —
# currently the Code Workspace Root new projects belong in — and then runs the
# command below. It never overwrites a value the owner has set.
COPY infra/devski-code/entrypoint.sh /usr/local/bin/devski-code-entrypoint.sh
RUN chmod +x /usr/local/bin/devski-code-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/devski-code-entrypoint.sh"]

# `serve` runs headless and prints one-shot pairing details to the log on
# first boot. Mint later pairing credentials with the auth control plane —
# `t3 pair` discovers servers through a runtime-state file this deployment does
# not have (see infra/devski-code/README.md):
#   node apps/server/src/bin.ts auth pairing create --base-dir /data/t3 --label iphone
CMD ["node", "apps/server/src/bin.ts", "serve", "--host", "0.0.0.0", "--port", "3773", "--base-dir", "/data/t3"]
