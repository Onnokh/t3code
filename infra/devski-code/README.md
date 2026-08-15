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
  state), `/workspaces/code` (Code Workspace Root);
- health check: `GET /.well-known/t3/environment` on port `3773`.

Coolify configuration for the private OpenCode 2 sidecar:

- same repository revision, Dockerfile location
  `infra/devski-code/Dockerfile.opencode`, context `/`;
- no public domain, no published ports; internal network alias
  `devski-opencode`;
- persistent volumes: `/data/opencode` (interactive OpenCode state) and the
  SAME `/workspaces/code` volume as the T3 container;
- environment: `OPENCODE_SERVER_PASSWORD` (Coolify secret) — the server's
  Basic-auth password;
- health check: authenticated `GET /api/health` on port `4096` (built into
  the image).

## Connect T3 to the sidecar

Configure the `opencode2` provider in T3's settings (Settings → Providers →
OpenCode 2, or the `providers.opencode2` block of the server settings file
under `/data/t3`):

| Setting          | Value                                 |
| ---------------- | ------------------------------------- |
| `serverUrl`      | `http://devski-opencode:4096`         |
| `serverPassword` | the `OPENCODE_SERVER_PASSWORD` secret |
| `workspaceRoot`  | `/workspaces/code`                    |

The provider then serves live model/agent inventory from the pinned server,
and Code threads run against it. Sessions whose directory resolves outside
`/workspaces/code` are rejected.

## Pairing

First boot prints a one-time pairing URL in the container log. Mint later
pairing credentials inside the container:

```sh
node apps/server/src/bin.ts pair --base-dir /data/t3
```

Enter the 12-character code in Devski (the app already defaults to
`https://devski.onkie.dev`), or run the Gateway smoke from
`Onnokh/digital-home` with `--pairing-code`.
