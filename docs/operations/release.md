# Devski Release Checklist

Devski is an iOS-only, TestFlight-first fork of T3 Code. The production Expo
configuration is resolved from `apps/mobile/app.config.ts` and the identity
manifest in `scripts/lib/devski-identity.ts`.

## Release boundary

- Production bundle: `dev.onkie.devski`
- Production App Group: `group.dev.onkie.devski`
- Production share extension: `dev.onkie.devski.sharing`
- Production widget extension: `dev.onkie.devski.widgets`
- Gateway: `https://devski.onkie.dev`
- OTA updates: disabled
- Release workflow: `.github/workflows/devski-ios.yml`
- Protected GitHub environment: `devski-production`

The release workflow is manual, requires the literal `RELEASE_DEVSKI`
confirmation, runs from `main`, and uses the protected environment's
`DEVSKI_EXPO_TOKEN`, mapped to the EAS CLI only for the build step. It builds
and submits iOS only. There is no OTA update step.

## Required checks

Run these commands from the T3 repository root before requesting a release:

```sh
pnpm --dir apps/mobile typecheck
pnpm --dir apps/mobile test
pnpm --dir apps/mobile verify:release
pnpm lint:mobile
```

`verify:release` resolves the public Expo configuration and fails if it finds
upstream T3 bundle, Clerk, Expo project, update, or workflow identities. It
also rejects stateful upstream workflows and only permits the protected manual
iOS release workflow to contain an EAS build command.

The upstream desktop, hosted-web, and relay publishing workflows are not part
of Devski's release boundary and are intentionally absent from this fork.
