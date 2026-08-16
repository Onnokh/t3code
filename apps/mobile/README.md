# Devski Mobile

> [!WARNING]
> T3 Code Mobile is currently in development and is not distributed yet. If you want to try it out, you can build it from source.

## Quickstart

> [!NOTE]
> Uses native modules so using Expo Go is not supported. You need to use the Expo Dev Client.

This app has three Devski variants:

- `development`: Expo dev client, installable side-by-side as `Devski Dev`
- `preview`: persistent internal preview build, installable side-by-side as `Devski Preview`
- `production`: iOS TestFlight build as `Devski`

Run commands from `apps/mobile`.

The production app uses the Devski Gateway at `https://devski.onkie.dev` and does not include
T3 Clerk or Expo update configuration. Public development configuration belongs in the
repository-root `.env` or `.env.local`, not an `apps/mobile/.env` file. See
[`../../.env.example`](../../.env.example).

## Development

Start Metro for the dev client:

```bash
vp run dev:client
```

Build and run the local iOS dev client:

```bash
vp run ios:dev
```

If your Xcode account only has a Personal Team, use a bundle identifier you control and opt into the
reduced-capability local build. Personal Team builds omit the widget and share extensions, push
entitlement, and native Sign in with Apple entitlement; builds without this opt-in are unchanged.

```bash
DEVSKI_IOS_PERSONAL_TEAM=1 \
DEVSKI_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.devski.dev \
vp run ios:dev
```

Build and install a self-contained Release app that does not need Metro:

```bash
vp run ios:release
```

The Personal Team equivalent also needs a unique bundle identifier:

```bash
DEVSKI_IOS_PERSONAL_TEAM=1 \
DEVSKI_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.devski \
vp run ios:release
```

Build and run the local iOS preview app:

```bash
vp run ios:preview
```

Force the review diff highlighter engine:

```bash
EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=javascript vp run ios:dev
```

`javascript` is the default and recommended setting for the review diff screen. Set `EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=native` only when you explicitly want to test the native Shiki engine.

Inspect the resolved Expo config and release guard:

```bash
vp run config:dev
vp run config:preview
pnpm verify:release
```

For the complete local server, install, one-time pairing, Code-thread, and three-tab acceptance
smoke, follow [`../../docs/operations/devski-local-smoke.md`](../../docs/operations/devski-local-smoke.md).

Run static checks for mobile native code:

```bash
node ../../scripts/mobile-native-static-check.ts
```

The native lint task runs SwiftLint for Swift plus ktlint and detekt for Kotlin. Missing native tools are reported as warnings and skipped locally. CI installs the default toolset from `apps/mobile/Brewfile` before running the native checks.

## EAS Builds

Preview builds are for local validation. Production OTA updates are disabled. TestFlight
publication is allowed only through the protected, manually dispatched
`.github/workflows/devski-ios.yml` workflow and its `devski-production` environment.

Create a PR preview dev-client build manually:

```bash
vp run eas:ios:preview:dev
```

Create a cloud dev-client build:

```bash
vp run eas:ios:dev
```

Create a persistent preview build:

```bash
vp run eas:ios:preview
```
