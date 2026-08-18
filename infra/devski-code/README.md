# devski-code

The private T3 environment behind the Devski Gateway, as accepted in
the Digital Home deployment topology (`docs/spec/devski-deployment-topology.md`
in `Onnokh/digital-home`).

## Shape

- One public origin exists: `https://devski.onkie.dev`, owned by the Devski
  Gateway. This T3 service is private and joins the same internal network with
  the alias the Gateway expects (default `devski-t3`, port `3773`).
- The phone pairs with T3 through the Gateway. This container keeps T3's
  existing discovery, pairing, Device Sessions, authenticated HTTP, and `/ws`
  ticket contracts unchanged.
- The full `devski-code` service is **two containers, versioned and
  smoke-tested together**:
  1. the T3 environment server (`Dockerfile`), including the Claude Agent SDK
     driver and the bounded external-server `opencode2` provider;
  2. the pinned interactive OpenCode 2 server (`Dockerfile.opencode`),
     reachable privately as `devski-opencode:4096`.
- Both containers mount the Code Workspace Root at exactly `/workspaces/code`;
  T3 and OpenCode must observe the same file identity and repository state at
  the same absolute path.
- Worktrees live in that root too, at `/workspaces/code/.worktrees`, through
  `T3CODE_WORKTREES_DIR`. T3 otherwise keeps them below its home
  (`/data/t3/worktrees`), a volume only the T3 container mounts — the sidecar
  cannot see a worktree there, and `startSession` rejects the thread for
  resolving outside the Code Workspace Root.

## Claude runtime and the one-time Max login

The T3 image installs the pinned Claude Code runtime and keeps every piece of
Claude state — the Max login (`.credentials.json`), `.claude.json`, sessions,
and Agent SDK state — on the persistent `/data/claude` volume through
`CLAUDE_CONFIG_DIR=/data/claude`. T3's Claude driver passes the container
environment to every Claude runtime it spawns (see `makeClaudeEnvironment` in
`apps/server/src/provider/Drivers/ClaudeHome.ts`), so one login survives
application restarts and redeployments. Claude credentials belong to the
server; they never reach the phone (see the authentication-boundary spec in
`Onnokh/digital-home`).

The version pin has one source of truth: `ARG CLAUDE_CODE_VERSION` in
`Dockerfile`. `apps/server/src/provider/Drivers/ClaudeRuntimePin.test.ts`
keeps the pin at or above the newest built-in model gate, and
`DISABLE_AUTOUPDATER=1` stops the running container from drifting off it.
Bump the version in the Dockerfile and redeploy; never update in place.

### One-time login (owner, on the deployed box)

1. Open a shell in the running T3 container (Coolify terminal, or
   `docker exec -it <t3-container> bash`).
2. Run `claude auth login`. The CLI prints a login URL: open it in the
   browser on your own machine, sign in with the Max account, and paste the
   authorization code back into the container terminal. The credential is
   written to `/data/claude/.credentials.json`.
3. Verify: `claude auth status` must report `"loggedIn": true` with the Max
   subscription, and
   `node infra/devski-code/claude-runtime-smoke.mjs --require-auth`
   must pass all checks.
4. Prove persistence once: restart the application (Coolify restart or
   `docker restart <t3-container>`) and run the smoke from step 3 again.
   T3's provider snapshot then reports Claude as authenticated in the Code
   UI without any new login.

### Runtime smoke

`infra/devski-code/claude-runtime-smoke.mjs` ships inside the image and
verifies the pinned runtime version, the `/data/claude` write permissions of
the service user, and (with `--require-auth`) the presence of the persisted
login state:

```sh
docker exec <t3-container> node infra/devski-code/claude-runtime-smoke.mjs
```

Run it after every deployment; run it with `--require-auth` after the
one-time login and after restarts.

## Version pin

The OpenCode 2 CLI/server and the `@opencode-ai/client` package must use the
same exact numeric prerelease. The single source of truth is
`OPENCODE2_PINNED_VERSION` in `apps/server/src/provider/opencode2Runtime.ts`;
it must equal:

- the `@opencode-ai/client` pin in `apps/server/package.json`, and
- the `@opencode-ai/cli` pin in `Dockerfile.opencode`.

The provider verifies the server build at runtime and reports any other build
as an unavailable state — there is no silent fallback and no parallel stable
OpenCode 1 server in this deployment.

## Build and run

```sh
docker build -f infra/devski-code/Dockerfile -t devski-code .
docker build -f infra/devski-code/Dockerfile.opencode -t devski-opencode .
```

Coolify configuration for the private T3 application:

- build from this repository at the revision pinned by
  `Onnokh/digital-home` (`apps/t3code` submodule);
- Dockerfile location `infra/devski-code/Dockerfile`, context `/`;
- no public domain, no published ports; internal network alias `devski-t3`;
- persistent volumes: `/data/t3` (T3 state), `/data/claude` (Claude runtime
  state), `/workspaces/code` (Code Workspace Root, and the worktrees below
  `.worktrees` that the sidecar must also see);
- health check: `GET /.well-known/t3/environment` on port `3773`.

T3 also serves `GET /healthz/agent-runtimes` on the private port: a
credential-free probe that projects the provider snapshots into one status
enum per Agent Runtime (`claude`, `opencode2`). The Devski Gateway uses it
to distinguish a Claude failure from an interactive OpenCode 2 failure in
its readiness and capability surfaces. It reports status enums only and is
deliberately absent from the Gateway's public pass-through allowlist.

Coolify configuration for the private OpenCode 2 sidecar:

- same repository revision, Dockerfile location
  `infra/devski-code/Dockerfile.opencode`, context `/`;
- no public domain, no published ports; internal network alias
  `devski-opencode`;
- persistent volumes: `/data/opencode` (interactive OpenCode state) and the
  SAME `/workspaces/code` volume as the T3 container;
- environment: `OPENCODE_SERVER_PASSWORD` (Coolify secret) — the server's
  Basic-auth password; `EXECUTOR_MCP_TOKEN` (Coolify secret) — the bearer for
  the Executor MCP (see Skills and MCP servers below). The T3 application takes
  the same value;
- health check: authenticated `GET /api/health` on port `4096` (built into
  the image).

## Skills and MCP servers

`infra/devski-code/agent-tools.json` is this service's one declaration of what
an agent can reach: the skill directories, and the MCP servers that front every
external integration. Both runtimes read that one file, by different routes,
because their configuration models differ:

| Runtime | How it gets the declaration |
| --- | --- |
| OpenCode 2 sidecar | `render-opencode-config.mjs` turns it into `/etc/devski/opencode.json` at **build** time; `OPENCODE_CONFIG` names that file |
| Claude runtime (T3 environment) | `entrypoint.sh` applies it at **boot**: it links `$CLAUDE_CONFIG_DIR/skills` at the installed library and declares each MCP server into Claude's user scope |

Claude Code needs the boot route because `CLAUDE_CONFIG_DIR` is a volume, and a
mount masks whatever the image put below it. That application is not a one-way
seed like the settings above it: the declaration wins on every boot, in both
directions. Remove a server from the file, or start without its credential, and
the previous boot's entry is removed rather than left behind.

Two consequences worth knowing:

- Claude stores the **resolved** bearer in `.claude.json` on the volume, unlike
  OpenCode's `{env:...}`, which is resolved when the config is read. Rotating
  the token therefore takes a container restart, and the volume holds a copy of
  it until then.
- `EXECUTOR_MCP_TOKEN` absent is a working container with no `executor` server,
  and the boot log says so: `mcp executor not declared: its credential is absent
  from the environment`.

The library itself is installed with the `skills` CLI (`skills add
Onnokh/skills --agent universal`), the command the library's README gives.
`universal` is the CLI's agent-neutral target, so all three Digital Home
runtimes resolve the same `/opt/agent-skills/.agents/skills`. Only the CLI is
pinned: `skills add` takes no git ref, so the library follows its default branch
at build time and `.agents/.skill-lock.json` records what landed.

The Digital Home Harness holds the matching declaration for its own image — its
build context excludes this repository, so it cannot read this file — and
`tests/local-stack.test.ts` in `Onnokh/digital-home` fails when the two
disagree.

## Connect T3 to the sidecar

The entrypoint seeds the `opencode2` provider on first boot, so no operator
step is needed. It writes these three values into the `providers.opencode2`
block of the server settings file under `/data/t3`:

| Setting          | Value                                          |
| ---------------- | ---------------------------------------------- |
| `serverUrl`      | `http://devski-opencode:4096`                  |
| `serverPassword` | the `OPENCODE_SERVER_PASSWORD` environment var |
| `workspaceRoot`  | `/workspaces/code`                             |

Seeding is one-way: it fills an absent `serverUrl` only, and does nothing when
`OPENCODE_SERVER_PASSWORD` is not set. An owner who edits the block on the
volume keeps that edit across restarts and redeployments.

This has to happen in the entrypoint because there is nowhere else to enter it.
The deployed image serves no web UI, so Settings → Providers is unreachable,
and the mobile app has no settings surface for a provider.

The provider then serves live model/agent inventory from the pinned server,
and Code threads run against it. Sessions whose directory resolves outside
`/workspaces/code` are rejected.

## Pairing

First boot prints a `Pairing URL` in the container log, but that URL does not
work in this deployment. It carries the container-internal address (for example
`http://172.18.0.15:3773`), which resolves nowhere outside the Docker network,
and this image ships no web UI, so T3 answers 503
(`No static directory configured and no dev URL set`) on `/pair`. The Gateway
does not proxy `/pair` either. Take the token out of that URL if you want it,
or mint a fresh credential below.

Mint every pairing credential inside the container with the auth control
plane, which writes directly to T3's auth store:

```sh
node apps/server/src/bin.ts auth pairing create --base-dir /data/t3 --label iphone
```

It prints the credential id, the 12-character code, and the expiry. The
default TTL is 5 minutes; pass `--ttl 15m` for more time, and `--json` for
scripts. Do not pass `--base-url https://devski.onkie.dev` on this deployment:
it only prints a `https://devski.onkie.dev/pair#token=...` link, and that path
404s at the Gateway for the reason above. Hand over the code, not a link.

Enter the 12-character code in Devski (the app already defaults to
`https://devski.onkie.dev`), or run the Gateway smoke from
`Onnokh/digital-home` with `--pairing-code`.

The companions use the same `--base-dir`:

```sh
node apps/server/src/bin.ts auth pairing list --base-dir /data/t3
node apps/server/src/bin.ts auth pairing revoke --base-dir /data/t3 <id>
```

`list` shows the id, label, scopes, and expiry of each active credential and
never reveals a code; `revoke` takes an id from that list.

Do not use `t3 pair` in this container. It discovers the server out of band
through the `userdata/server-runtime.json` file a live server writes next to
its database, and then probes the origin recorded there. The server does write
that file at activation, but a rolling deploy removes it again: Coolify starts
the new container and waits for its healthcheck before it stops the old one,
and the shutdown finalizer of the old container deletes the shared path on the
`/data/t3` volume without a check that it still owns the file. The file is
therefore absent while the server is healthy, and nothing is logged because the
removal succeeded. `pair` then fails with
`NoRunningServerError: No running T3 Code server found.`, and it has no flag
that points it at a known-running server. `pair` also requires the recorded PID
to be alive in the caller's own PID namespace, which never holds from another
container.
`auth pairing create` needs no discovery and mints the same standard-scope
client credential that `pair` would.
