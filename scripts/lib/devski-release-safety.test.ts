import { describe, expect, it } from "vite-plus/test";

import { DEVSKI_IDENTITY, resolveDevskiIdentity } from "./devski-identity.ts";
import {
  assertDevskiConfigIsSafe,
  findDevskiConfigViolations,
  findWorkflowSafetyViolations,
} from "./devski-release-safety.ts";

function safeConfig() {
  const identity = resolveDevskiIdentity("production");
  return {
    name: identity.appName,
    slug: DEVSKI_IDENTITY.slug,
    owner: DEVSKI_IDENTITY.expoOwner,
    scheme: identity.scheme,
    platforms: ["ios"],
    updates: { enabled: false },
    runtimeVersion: undefined,
    ios: {
      bundleIdentifier: identity.iosBundleIdentifier,
      associatedDomains: ["applinks:devski.onkie.dev", "webcredentials:devski.onkie.dev"],
    },
    plugins: [
      identity.iosAppGroupIdentifier,
      identity.iosShareExtensionBundleIdentifier,
      identity.iosWidgetExtensionBundleIdentifier,
    ],
  };
}

describe("Devski resolved release configuration", () => {
  it("accepts the production identity and disabled OTA configuration", () => {
    expect(findDevskiConfigViolations(safeConfig())).toEqual([]);
    expect(() => assertDevskiConfigIsSafe(safeConfig())).not.toThrow();
  });

  it("rejects upstream identity drift and OTA enablement", () => {
    const config = {
      ...safeConfig(),
      owner: "pingdotgg",
      updates: { enabled: true, url: "https://u.expo.dev/upstream" },
      runtimeVersion: { policy: "fingerprint" },
      extra: { eas: { projectId: "upstream" }, clerk: { publishableKey: "pk_test" } },
      ios: {
        ...safeConfig().ios,
        bundleIdentifier: "com.t3tools.t3code",
      },
    };

    expect(findDevskiConfigViolations(config)).toEqual(
      expect.arrayContaining([
        "owner must be onnokleinhofmeijer",
        "updates.enabled must be false",
        "updates.url must be omitted when OTA is disabled",
        "runtimeVersion must be omitted when OTA is disabled",
        "extra.eas must not contain an upstream Expo project identity",
        "extra.clerk must not be present in a Devski release",
        "ios.bundleIdentifier must be dev.onkie.devski",
      ]),
    );
  });
});

describe("Devski workflow guard", () => {
  it("rejects upstream stateful workflows", () => {
    expect(
      findWorkflowSafetyViolations([
        { path: ".github/workflows/release.yml", source: "eas build --platform ios" },
        { path: ".github/workflows/preview.yml", source: "eas update --channel preview" },
      ]),
    ).toEqual([
      ".github/workflows/release.yml is an upstream stateful workflow and must be removed",
      ".github/workflows/preview.yml contains a stateful publishing or deployment command",
    ]);
  });

  it("allows only a manual iOS build workflow to publish", () => {
    expect(
      findWorkflowSafetyViolations([
        {
          path: ".github/workflows/devski-ios-release.yml",
          source:
            "on:\n  workflow_dispatch:\njobs:\n  build:\n    if: github.repository == 'Onnokh/t3code'\n    environment: devski-production\n    env:\n      EXPO_TOKEN: ${{ secrets.DEVSKI_EXPO_TOKEN }}\n    run: eas build --platform ios --profile devski-production --auto-submit --non-interactive",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects extra stateful commands in the release workflow", () => {
    expect(
      findWorkflowSafetyViolations([
        {
          path: ".github/workflows/devski-ios-release.yml",
          source:
            "on:\n  workflow_dispatch:\njobs:\n  build:\n    if: github.repository == 'Onnokh/t3code'\n    environment: devski-production\n    env:\n      EXPO_TOKEN: ${{ secrets.DEVSKI_EXPO_TOKEN }}\n    run: eas build --platform ios --profile devski-production --auto-submit --non-interactive && npm publish",
        },
      ]),
    ).toContain("devski-ios-release.yml must not contain any additional stateful command");
  });
});
