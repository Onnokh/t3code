# devski-code

The private T3 environment container behind the Devski Gateway, as accepted in
the Digital Home deployment topology (`docs/spec/devski-deployment-topology.md`
in `Onnokh/digital-home`).

## Shape

- One public origin exists: `https://devski.onkie.dev`, owned by the Devski
  Gateway. This T3 service is private and joins the same internal network with
  the alias the Gateway expects (default `devski-t3`, port `3773`).
- The phone pairs with T3 through the Gateway. This container keeps T3's
  existing discovery, pairing, Device Sessions, authenticated HTTP, and `/ws`
  ticket contracts unchanged.
- The full `devski-code` service adds a pinned interactive OpenCode 2 sidecar
  that mounts the same Code Workspace Root at `/workspaces/code`. The sidecar
  is not part of this first vertical slice.

## Build and run

```sh
docker build -f infra/devski-code/Dockerfile -t devski-code .
```

Coolify configuration for the private application:

- build from this repository at the revision pinned by
  `Onnokh/digital-home` (`apps/t3code` submodule);
- Dockerfile location `infra/devski-code/Dockerfile`, context `/`;
- no public domain, no published ports; internal network alias `devski-t3`;
- persistent volumes: `/data/t3` (T3 state), `/data/claude` (Claude runtime
  state), `/workspaces/code` (Code Workspace Root);
- health check: `GET /.well-known/t3/environment` on port `3773`.

## Pairing

First boot prints a one-time pairing URL in the container log. Mint later
pairing credentials inside the container:

```sh
node apps/server/src/bin.ts pair --base-dir /data/t3
```

Enter the 12-character code in Devski (the app already defaults to
`https://devski.onkie.dev`), or run the Gateway smoke from
`Onnokh/digital-home` with `--pairing-code`.
