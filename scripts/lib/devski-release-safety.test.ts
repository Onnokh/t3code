import { describe, expect, it } from "vite-plus/test";

import { DEVSKI_IDENTITY, resolveDevskiIdentity } from "./devski-identity.ts";
import {
  assertDevskiConfigIsSafe,
  findDevskiEasConfigViolations,
  findDevskiConfigViolations,
  findWorkflowSafetyViolations,
} from "./devski-release-safety.ts";

function safeConfig() {
  const identity = resolveDevskiIdentity("production");
  return {
    name: identity.appName,
    version: DEVSKI_IDENTITY.marketingVersion,
    slug: DEVSKI_IDENTITY.slug,
    owner: DEVSKI_IDENTITY.expoOwner,
    scheme: identity.scheme,
    platforms: ["ios"],
    updates: { enabled: false },
    runtimeVersion: undefined,
    ios: {
      bundleIdentifier: identity.iosBundleIdentifier,
      appleTeamId: DEVSKI_IDENTITY.appleTeamId,
      associatedDomains: [],
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
        appleTeamId: "UPSTREAMTEAM",
        associatedDomains: ["webcredentials:clerk.t3.codes"],
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
        `ios.appleTeamId must be ${DEVSKI_IDENTITY.appleTeamId}`,
        "ios.associatedDomains must be empty until Devski universal links ship",
      ]),
    );
  });
});

describe("Devski workflow guard", () => {
  it("rejects an unclassified workflow even when it has no known publishing command", () => {
    expect(
      findWorkflowSafetyViolations([
        { path: ".github/workflows/surprise.yml", source: "on: pull_request\njobs: {}" },
      ]),
    ).toEqual([
      ".github/workflows/surprise.yml is not classified in the Devski workflow inventory",
    ]);
  });

  it("requires upstream stateful workflows to be guarded from the fork", () => {
    expect(
      findWorkflowSafetyViolations([
        { path: ".github/workflows/pr-size.yml", source: "permissions:\n  issues: write" },
      ]),
    ).toEqual([".github/workflows/pr-size.yml must be restricted to the upstream T3 repository"]);
    expect(
      findWorkflowSafetyViolations([
        {
          path: ".github/workflows/pr-size.yml",
          source: "if: github.repository == 'pingdotgg/t3code'",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects upstream stateful workflows", () => {
    expect(
      findWorkflowSafetyViolations([
        { path: ".github/workflows/release.yml", source: "eas build --platform ios" },
        { path: ".github/workflows/preview.yml", source: "eas update --channel preview" },
      ]),
    ).toEqual([
      ".github/workflows/release.yml is an upstream stateful workflow and must be removed",
      ".github/workflows/preview.yml is not classified in the Devski workflow inventory",
    ]);
  });

  it("allows only a manual iOS build workflow to publish", () => {
    expect(
      findWorkflowSafetyViolations([
        {
          path: ".github/workflows/devski-ios.yml",
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
          path: ".github/workflows/devski-ios.yml",
          source:
            "on:\n  workflow_dispatch:\njobs:\n  build:\n    if: github.repository == 'Onnokh/t3code'\n    environment: devski-production\n    env:\n      EXPO_TOKEN: ${{ secrets.DEVSKI_EXPO_TOKEN }}\n    run: eas build --platform ios --profile devski-production --auto-submit --non-interactive && npm publish",
        },
      ]),
    ).toContain("devski-ios.yml must not contain any additional stateful command");
  });
});

describe("Devski EAS configuration", () => {
  it("accepts the committed local and protected production profiles", () => {
    expect(
      findDevskiEasConfigViolations({
        cli: { appVersionSource: "remote" },
        build: {
          development: {
            env: { APP_VARIANT: "development" },
            developmentClient: true,
            distribution: "internal",
          },
          preview: {
            env: { APP_VARIANT: "preview" },
            distribution: "internal",
          },
          "preview:dev": {
            env: { APP_VARIANT: "preview" },
            developmentClient: true,
            distribution: "internal",
          },
          "devski-production": {
            env: { APP_VARIANT: "production" },
            environment: "production",
            distribution: "store",
            autoIncrement: true,
          },
        },
      }),
    ).toEqual([]);
  });

  it("rejects identity drift and an OTA channel in EAS profiles", () => {
    expect(
      findDevskiEasConfigViolations({
        build: {
          development: { env: { APP_VARIANT: "production" }, distribution: "store" },
          preview: { env: { APP_VARIANT: "preview" }, channel: "preview" },
          "preview:dev": { env: { APP_VARIANT: "preview" } },
          "devski-production": {
            env: { APP_VARIANT: "preview" },
            distribution: "internal",
            channel: "production",
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "build.development.env.APP_VARIANT must be development",
        "build.development.distribution must be internal",
        "build.preview.channel must be omitted while OTA updates are disabled",
        "build.devski-production.env.APP_VARIANT must be production",
        "build.devski-production.distribution must be store",
        "build.devski-production.channel must be omitted while OTA updates are disabled",
      ]),
    );
  });
});
