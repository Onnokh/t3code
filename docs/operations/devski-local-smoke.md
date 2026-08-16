# Devski local shell smoke

Use this checkpoint to prove the local iOS app without TestFlight or a deployed Devski Gateway.
It exercises the existing T3 pairing and Code stack, then confirms that SEO and Automations share
the paired environment and report the intentionally unavailable Gateway honestly.

## Prerequisites

- Node `24.13.1` and the repository's pinned pnpm/Vite+ toolchain.
- Xcode with an installed iOS simulator runtime, or an attached development iPhone.
- A provider already supported and authenticated by the T3 server, plus a test workspace the
  provider may edit.
- For a physical iPhone, either both devices on the same reachable network or Tailscale on both.
  A Personal Team build needs a unique reverse-DNS bundle identifier that belongs to that team.

Run from the T3 repository root unless a step says otherwise.

## 1. Verify release safety

```bash
pnpm --dir apps/mobile verify:release
pnpm --dir apps/mobile typecheck
pnpm --dir apps/mobile test
```

The release verifier must report that the resolved production Expo/EAS configuration and workflow
inventory are safe. Production OTA, Clerk, upstream Expo identity, and unclassified workflows are
failures.

## 2. Start a fresh local T3 environment

For the iOS simulator, start the full development stack. The simulator can reach the Mac's
loopback address.

```bash
vp run dev --home-dir /tmp/devski-local-smoke
```

For a physical iPhone on the same tailnet, publish the development origin through Tailscale HTTPS:

```bash
vp run dev --share --home-dir /tmp/devski-local-smoke
```

Keep this terminal running. It prints a one-time pairing URL. Treat that URL like a password and do
not paste it into logs, screenshots, issues, or commits. If the server is already running, mint a
fresh one-time link with `npx t3 pair` (local/LAN) or `npx t3 pair --tailscale`.

## 3. Build, install, and launch Devski

In a second terminal:

```bash
cd apps/mobile
vp run ios:dev
```

For a free Personal Team, omit App Groups, push, Sign in with Apple, and associated domains by using
the reduced-capability variant:

```bash
cd apps/mobile
DEVSKI_IOS_PERSONAL_TEAM=1 \
DEVSKI_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.devski.dev \
vp run ios:dev
```

Replace `com.example.devski.dev` with a bundle identifier controlled by the selected team. The app
must install and open as **Devski Dev**; Expo Go is neither required nor supported.

## 4. Pair once

1. In Code, open **Environments** → **Add environment**.
2. Scan the server QR code or paste the complete one-time pairing URL.
3. Wait until the environment reports connected.
4. Leave and reopen Environments. Confirm the saved environment reconnects without reusing the
   one-time credential.

Expected: one durable bearer-backed environment is available app-wide. A rejected, expired, or
already-used pairing credential must not create a connection.

## 5. Exercise the unchanged Code stack

1. Add or select the test workspace in the paired environment.
2. Create a thread using an already-supported authenticated provider.
3. Send a small real prompt and wait for the turn to complete.
4. Return to the thread list, then reopen the same thread and confirm its messages remain.
5. Open one existing Code surface such as Terminal or Review and return to the thread.

Expected: Code uses the existing T3 home, workspace, thread, terminal, and review navigation. The
Devski shell adds no alternate provider, workspace, or thread implementation.

## 6. Exercise all root tabs

1. With the real thread open, switch to **SEO**.
2. Confirm the page reports the same connected Code environment and shows honest Gateway health.
   Paired directly with a plain T3 dev server, it must say that no Devski Gateway is answering at
   this environment. Paired through a running Devski Gateway, it must show the per-service health
   from `GET /api/devski/v1/capabilities` and the Device Session expiry instead.
3. Switch to **Automations** and confirm the same state.
4. Switch back to **Code**.

Expected: the original thread is still selected because each native root tab retains its own stack
and Code was never unmounted. SEO and Automations never claim more availability than the Gateway
reported.

## Record the result

Record the commit, device/runtime, provider, and pass/fail result without copying pairing URLs or
bearer credentials. A complete record contains:

- resolved release guard, mobile typecheck, and mobile test result;
- iOS prebuild/build/install/launch result;
- one-time pair and reconnect result;
- real thread create/complete/reopen result; and
- Code → SEO → Automations → Code state-preservation result.

Stop the dev process when finished. The isolated `/tmp/devski-local-smoke` state can be deleted
after no process is using it.
