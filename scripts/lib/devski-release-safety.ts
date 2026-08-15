import {
  DEVSKI_IDENTITY,
  resolveDevskiIdentity,
  type DevskiAppVariant,
} from "./devski-identity.ts";

const FORBIDDEN_IDENTITY_MARKERS = [
  "clerk.t3.codes",
  "u.expo.dev/d763fcb8-d37c-41ea-a773-b54a0ab4a454",
  "d763fcb8-d37c-41ea-a773-b54a0ab4a454",
  "com.t3tools.t3code",
  "group.com.t3tools.t3code",
  "pingdotgg",
] as const;

const STATEFUL_UPSTREAM_WORKFLOWS = new Set([
  "deploy-relay.yml",
  "mobile-eas-preview.yml",
  "mobile-eas-production.yml",
  "release.yml",
  "web-preview.yml",
]);

const WORKFLOW_CLASS = {
  "ci.yml": "validation",
  "devski-ios.yml": "devski-release",
  "issue-labels.yml": "upstream-stateful",
  "mobile-fingerprint-check.yml": "upstream-stateful",
  "mobile-showcase-screenshots.yml": "validation",
  "pr-size.yml": "upstream-stateful",
  "pr-vouch.yml": "upstream-stateful",
  "thread-transfer-report.yml": "upstream-stateful",
} as const satisfies Record<string, "validation" | "upstream-stateful" | "devski-release">;

const STATEFUL_COMMANDS = [
  /\beas\s+build\b/i,
  /\beas\s+update\b/i,
  /\b(?:npm|pnpm|vp)\s+(?:publish|deploy)\b/i,
  /\bvercel\s+(?:deploy|alias)\b/i,
  /\bgh\s+release\s+(?:create|upload)\b/i,
  /\b(?:vp\s+run|pnpm\s+run)\s+[^\n]*\bdeploy\b/i,
] as const;

const ALLOWED_RELEASE_COMMAND =
  /\beas\s+build\s+--platform\s+ios\s+--profile\s+devski-production\s+--auto-submit\s+--non-interactive\b/i;

export interface WorkflowSource {
  readonly path: string;
  readonly source: string;
}

export interface ResolvedExpoConfig {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly slug?: unknown;
  readonly owner?: unknown;
  readonly scheme?: unknown;
  readonly platforms?: unknown;
  readonly updates?: {
    readonly enabled?: unknown;
    readonly url?: unknown;
  };
  readonly runtimeVersion?: unknown;
  readonly ios?: {
    readonly bundleIdentifier?: unknown;
    readonly appleTeamId?: unknown;
    readonly associatedDomains?: unknown;
  };
  readonly extra?: {
    readonly eas?: { readonly projectId?: unknown };
    readonly clerk?: unknown;
  };
  readonly plugins?: unknown;
}

export interface ResolvedEasConfig {
  readonly cli?: { readonly appVersionSource?: unknown };
  readonly build?: Readonly<
    Record<
      string,
      | {
          readonly env?: Readonly<Record<string, unknown>>;
          readonly environment?: unknown;
          readonly developmentClient?: unknown;
          readonly distribution?: unknown;
          readonly autoIncrement?: unknown;
          readonly channel?: unknown;
        }
      | undefined
    >
  >;
  readonly submit?: {
    readonly "devski-production"?: { readonly ios?: { readonly ascAppId?: unknown } };
  };
}

export function findDevskiConfigViolations(
  config: ResolvedExpoConfig,
  variant: DevskiAppVariant = "production",
): ReadonlyArray<string> {
  const expected = resolveDevskiIdentity(variant);
  const serializedConfig = JSON.stringify(config);
  const violations: string[] = [];

  if (config.name !== expected.appName) {
    violations.push(`name must be ${expected.appName}`);
  }
  if (config.version !== DEVSKI_IDENTITY.marketingVersion) {
    violations.push(`version must be ${DEVSKI_IDENTITY.marketingVersion}`);
  }
  if (config.slug !== DEVSKI_IDENTITY.slug) {
    violations.push(`slug must be ${DEVSKI_IDENTITY.slug}`);
  }
  if (config.owner !== DEVSKI_IDENTITY.expoOwner) {
    violations.push(`owner must be ${DEVSKI_IDENTITY.expoOwner}`);
  }
  if (JSON.stringify(config.platforms) !== JSON.stringify(["ios"])) {
    violations.push("platforms must contain only ios");
  }
  if (config.scheme !== expected.scheme) {
    violations.push(`scheme must be ${expected.scheme}`);
  }
  if (config.ios?.bundleIdentifier !== expected.iosBundleIdentifier) {
    violations.push(`ios.bundleIdentifier must be ${expected.iosBundleIdentifier}`);
  }
  if (config.ios?.appleTeamId !== DEVSKI_IDENTITY.appleTeamId) {
    violations.push(`ios.appleTeamId must be ${DEVSKI_IDENTITY.appleTeamId}`);
  }

  for (const nativeIdentity of [
    expected.iosAppGroupIdentifier,
    expected.iosShareExtensionBundleIdentifier,
    expected.iosWidgetExtensionBundleIdentifier,
  ]) {
    if (!serializedConfig.includes(nativeIdentity)) {
      violations.push(`resolved configuration must include ${nativeIdentity}`);
    }
  }

  const associatedDomains = Array.isArray(config.ios?.associatedDomains)
    ? config.ios.associatedDomains
    : [];
  if (associatedDomains.length > 0) {
    violations.push("ios.associatedDomains must be empty until Devski universal links ship");
  }

  if (config.updates?.enabled !== false) {
    violations.push("updates.enabled must be false");
  }
  if (config.updates?.url !== undefined && config.updates.url !== null) {
    violations.push("updates.url must be omitted when OTA is disabled");
  }
  if (config.runtimeVersion !== undefined) {
    violations.push("runtimeVersion must be omitted when OTA is disabled");
  }
  if (config.extra?.eas?.projectId !== undefined) {
    if (
      DEVSKI_IDENTITY.easProjectId === null ||
      config.extra.eas.projectId !== DEVSKI_IDENTITY.easProjectId
    ) {
      violations.push("extra.eas must not contain an upstream Expo project identity");
    }
  }
  if (config.extra?.clerk !== undefined) {
    violations.push("extra.clerk must not be present in a Devski release");
  }
  if (serializedConfig.includes("@clerk/expo")) {
    violations.push("the resolved production config must not include the Clerk config plugin");
  }
  for (const marker of FORBIDDEN_IDENTITY_MARKERS) {
    if (serializedConfig.includes(marker)) {
      violations.push(`resolved configuration contains forbidden upstream identity ${marker}`);
    }
  }

  return violations;
}

export function assertDevskiConfigIsSafe(
  config: ResolvedExpoConfig,
  variant: DevskiAppVariant = "production",
): void {
  const violations = findDevskiConfigViolations(config, variant);
  if (violations.length > 0) {
    throw new Error(`Devski release configuration is unsafe:\n- ${violations.join("\n- ")}`);
  }
}

export function findWorkflowSafetyViolations(
  workflows: ReadonlyArray<WorkflowSource>,
): ReadonlyArray<string> {
  const violations: string[] = [];

  for (const workflow of workflows) {
    const fileName = workflow.path.split("/").pop() ?? workflow.path;
    if (STATEFUL_UPSTREAM_WORKFLOWS.has(fileName)) {
      violations.push(`${workflow.path} is an upstream stateful workflow and must be removed`);
      continue;
    }

    const workflowClass = WORKFLOW_CLASS[fileName as keyof typeof WORKFLOW_CLASS];
    if (!workflowClass) {
      violations.push(`${workflow.path} is not classified in the Devski workflow inventory`);
      continue;
    }
    const hasStatefulCommand = STATEFUL_COMMANDS.some((pattern) => pattern.test(workflow.source));
    if (workflowClass === "validation") {
      if (hasStatefulCommand) {
        violations.push(
          `${workflow.path} is classified as validation but contains a stateful command`,
        );
      }
      continue;
    }
    if (workflowClass === "upstream-stateful") {
      if (!/github\.repository\s*==\s*['"]pingdotgg\/t3code['"]/.test(workflow.source)) {
        violations.push(`${workflow.path} must be restricted to the upstream T3 repository`);
      }
      continue;
    }
    if (
      !/^\s*workflow_dispatch:/m.test(workflow.source) ||
      /^\s*(?:push|schedule|pull_request|pull_request_target):/m.test(workflow.source)
    ) {
      violations.push("devski-ios.yml must be manually dispatched only");
    }
    if (!/github\.repository\s*==\s*['"]Onnokh\/t3code['"]/.test(workflow.source)) {
      violations.push("devski-ios.yml must be restricted to the Devski T3 repository");
    }
    if (!/github\.ref\s*==\s*['"]refs\/heads\/main['"]/.test(workflow.source)) {
      violations.push("devski-ios.yml must build only from fork main (release-source guard)");
    }
    if (!/environment:\s*devski-production\b/.test(workflow.source)) {
      violations.push("devski-ios.yml must use the protected devski-production environment");
    }
    if (!ALLOWED_RELEASE_COMMAND.test(workflow.source)) {
      violations.push(
        "devski-ios.yml may only run the protected Devski iOS build and submit command",
      );
    }
    if (STATEFUL_COMMANDS.slice(1).some((pattern) => pattern.test(workflow.source))) {
      violations.push("devski-ios.yml must not contain any additional stateful command");
    }
    if (!/secrets\.DEVSKI_EXPO_TOKEN/.test(workflow.source)) {
      violations.push("devski-ios.yml must use the protected DEVSKI_EXPO_TOKEN secret");
    }
  }

  return violations;
}

export function findDevskiEasConfigViolations(config: ResolvedEasConfig): ReadonlyArray<string> {
  const violations: string[] = [];
  const expectedProfiles = {
    development: {
      variant: "development",
      distribution: "internal",
      developmentClient: true,
    },
    preview: { variant: "preview", distribution: "internal", developmentClient: false },
    "preview:dev": { variant: "preview", distribution: "internal", developmentClient: true },
    "devski-production": {
      variant: "production",
      distribution: "store",
      developmentClient: false,
    },
  } as const;

  for (const [profileName, expected] of Object.entries(expectedProfiles)) {
    const profile = config.build?.[profileName];
    if (!profile) {
      violations.push(`build.${profileName} must be defined`);
      continue;
    }
    if (profile.env?.APP_VARIANT !== expected.variant) {
      violations.push(`build.${profileName}.env.APP_VARIANT must be ${expected.variant}`);
    }
    if (profile.distribution !== expected.distribution) {
      violations.push(`build.${profileName}.distribution must be ${expected.distribution}`);
    }
    if (expected.developmentClient && profile.developmentClient !== true) {
      violations.push(`build.${profileName}.developmentClient must be true`);
    }
    if (!expected.developmentClient && profile.developmentClient === true) {
      violations.push(`build.${profileName}.developmentClient must not be true`);
    }
    if (profile.channel !== undefined) {
      violations.push(
        `build.${profileName}.channel must be omitted while OTA updates are disabled`,
      );
    }
  }

  const production = config.build?.["devski-production"];
  if (production?.environment !== "production") {
    violations.push("build.devski-production.environment must be production");
  }
  if (production?.autoIncrement !== true) {
    violations.push("build.devski-production.autoIncrement must be true");
  }
  if (config.cli?.appVersionSource !== "remote") {
    violations.push("cli.appVersionSource must be remote");
  }
  const ascAppId = config.submit?.["devski-production"]?.ios?.ascAppId;
  if (DEVSKI_IDENTITY.appStoreConnectAppId === null) {
    if (ascAppId !== undefined) {
      violations.push(
        "submit.devski-production.ios.ascAppId must be omitted until Devski provisioning",
      );
    }
  } else if (ascAppId !== DEVSKI_IDENTITY.appStoreConnectAppId) {
    violations.push(
      "submit.devski-production.ios.ascAppId must match the Devski identity manifest",
    );
  }

  return violations;
}

export function assertDevskiEasConfigIsSafe(config: ResolvedEasConfig): void {
  const violations = findDevskiEasConfigViolations(config);
  if (violations.length > 0) {
    throw new Error(`Devski EAS configuration is unsafe:\n- ${violations.join("\n- ")}`);
  }
}

export function assertWorkflowSourcesAreSafe(workflows: ReadonlyArray<WorkflowSource>): void {
  const violations = findWorkflowSafetyViolations(workflows);
  if (violations.length > 0) {
    throw new Error(`Devski workflow guard failed:\n- ${violations.join("\n- ")}`);
  }
}
