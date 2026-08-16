import { describe, expect, it } from "vite-plus/test";

import { DEVSKI_IDENTITY, resolveDevskiIdentity } from "./devski-identity.ts";
import {
  assertDevskiConfigIsSafe,
  assertNativeIosSigningIsSafe,
  findDevskiEasConfigViolations,
  findDevskiConfigViolations,
  findNativeIosSigningViolations,
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
            "on:\n  workflow_dispatch:\njobs:\n  build:\n    if: github.repository == 'Onnokh/t3code' && github.ref == 'refs/heads/main'\n    environment: devski-production\n    env:\n      EXPO_TOKEN: ${{ secrets.DEVSKI_EXPO_TOKEN }}\n    run: eas build --platform ios --profile devski-production --auto-submit --non-interactive",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects a release workflow without the fork-main release-source guard", () => {
    expect(
      findWorkflowSafetyViolations([
        {
          path: ".github/workflows/devski-ios.yml",
          source:
            "on:\n  workflow_dispatch:\njobs:\n  build:\n    if: github.repository == 'Onnokh/t3code'\n    environment: devski-production\n    env:\n      EXPO_TOKEN: ${{ secrets.DEVSKI_EXPO_TOKEN }}\n    run: eas build --platform ios --profile devski-production --auto-submit --non-interactive",
        },
      ]),
    ).toContain("devski-ios.yml must build only from fork main (release-source guard)");
  });

  it("rejects a release workflow that also reacts to pushes or pull requests", () => {
    expect(
      findWorkflowSafetyViolations([
        {
          path: ".github/workflows/devski-ios.yml",
          source:
            "on:\n  workflow_dispatch:\n  pull_request:\njobs:\n  build:\n    if: github.repository == 'Onnokh/t3code' && github.ref == 'refs/heads/main'\n    environment: devski-production\n    env:\n      EXPO_TOKEN: ${{ secrets.DEVSKI_EXPO_TOKEN }}\n    run: eas build --platform ios --profile devski-production --auto-submit --non-interactive",
        },
      ]),
    ).toContain("devski-ios.yml must be manually dispatched only");
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

const PBXPROJ_PATH = "apps/mobile/ios/DevskiDev.xcodeproj/project.pbxproj";

let objectIdentifierCount = 0;
function objectIdentifier() {
  objectIdentifierCount += 1;
  return objectIdentifierCount.toString(16).toUpperCase().padStart(24, "0");
}

/**
 * The config plugins that add the extension targets write `name` before `isa`,
 * the Expo template writes it after, and one target lists its build settings
 * as a nested array. The fixtures keep all three shapes so the guard cannot
 * pass by reading the neighbouring object.
 */
function targetConfiguration({
  bundleIdentifier,
  name,
  developmentTeam,
  nameFirst = true,
}: {
  readonly bundleIdentifier: string;
  readonly name: string;
  readonly developmentTeam?: string;
  readonly nameFirst?: boolean;
}) {
  const header = [`\t\t\tname = ${name};`, "\t\t\tisa = XCBuildConfiguration;"];
  return [
    `\t\t${objectIdentifier()} /* ${name} */ = {`,
    ...(nameFirst ? header : [header[1]!]),
    "\t\t\tbuildSettings = {",
    ...(developmentTeam === undefined ? [] : [`\t\t\t\tDEVELOPMENT_TEAM = ${developmentTeam};`]),
    "\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (",
    '\t\t\t\t\t"$(inherited)",',
    "\t\t\t\t);",
    `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "${bundleIdentifier}";`,
    '\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";',
    "\t\t\t};",
    ...(nameFirst ? [] : [header[0]!]),
    "\t\t};",
  ].join("\n");
}

// A project-level configuration builds no product and is never signed.
const PROJECT_CONFIGURATION = [
  `\t\t${objectIdentifier()} /* Release */ = {`,
  "\t\t\tisa = XCBuildConfiguration;",
  "\t\t\tbuildSettings = {",
  '\t\t\t\tSDKROOT = "iphoneos";',
  "\t\t\t};",
  "\t\t\tname = Release;",
  "\t\t};",
].join("\n");

function pbxproj(configurations: ReadonlyArray<string>, targetAttributeTeams: string = "") {
  return [
    "// !$*UTF8*$!",
    "{",
    "\tobjects = {",
    targetAttributeTeams,
    ...configurations,
    "\t};",
    "}",
  ].join("\n");
}

function devskiProject(developmentTeam: string | undefined) {
  return pbxproj([
    PROJECT_CONFIGURATION,
    targetConfiguration({
      bundleIdentifier: "dev.onkie.devski",
      name: "Debug",
      developmentTeam: DEVSKI_IDENTITY.appleTeamId,
      nameFirst: false,
    }),
    targetConfiguration({
      bundleIdentifier: "dev.onkie.devski.widgets",
      name: "Release",
      developmentTeam: DEVSKI_IDENTITY.appleTeamId,
    }),
    targetConfiguration({
      bundleIdentifier: "dev.onkie.devski.sharing",
      name: "Release",
      ...(developmentTeam === undefined ? {} : { developmentTeam }),
    }),
  ]);
}

describe("Devski generated iOS project signing identity", () => {
  it("accepts a project where every signable target carries the Devski Apple team", () => {
    expect(
      findNativeIosSigningViolations({
        path: PBXPROJ_PATH,
        source: devskiProject(DEVSKI_IDENTITY.appleTeamId),
      }),
    ).toEqual([]);
  });

  it("rejects an extension target that prebuild left without a team", () => {
    expect(
      findNativeIosSigningViolations({ path: PBXPROJ_PATH, source: devskiProject(undefined) }),
    ).toEqual([
      `${PBXPROJ_PATH}: target dev.onkie.devski.sharing (Release) has no DEVELOPMENT_TEAM, ` +
        "so expo run:ios re-signs every target with a keychain team",
    ]);
  });

  it("rejects a target signed by another Apple team", () => {
    expect(
      findNativeIosSigningViolations({ path: PBXPROJ_PATH, source: devskiProject("YVWRBCSWU7") }),
    ).toEqual([
      `${PBXPROJ_PATH}: target dev.onkie.devski.sharing (Release) must use DEVELOPMENT_TEAM ` +
        `${DEVSKI_IDENTITY.appleTeamId}, found YVWRBCSWU7`,
    ]);
  });

  it("rejects a stale team in the Xcode signing pane", () => {
    const source = pbxproj(
      [
        targetConfiguration({
          bundleIdentifier: "dev.onkie.devski",
          name: "Debug",
          developmentTeam: `"${DEVSKI_IDENTITY.appleTeamId}"`,
        }),
      ],
      '\t\t\t\t\t\tDevelopmentTeam = "YVWRBCSWU7";',
    );

    expect(findNativeIosSigningViolations({ path: PBXPROJ_PATH, source })).toEqual([
      `${PBXPROJ_PATH}: TargetAttributes DevelopmentTeam must be ${DEVSKI_IDENTITY.appleTeamId}, ` +
        "found YVWRBCSWU7",
    ]);
  });

  it("rejects a project the guard cannot read instead of passing it", () => {
    expect(findNativeIosSigningViolations({ path: PBXPROJ_PATH, source: pbxproj([]) })).toEqual([
      `${PBXPROJ_PATH} declares no signable target build configuration`,
    ]);
    expect(() =>
      assertNativeIosSigningIsSafe({ path: PBXPROJ_PATH, source: devskiProject(undefined) }),
    ).toThrow(/native iOS signing identity is unsafe/);
  });
});
