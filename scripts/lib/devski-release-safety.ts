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
    readonly associatedDomains?: unknown;
  };
  readonly extra?: {
    readonly eas?: { readonly projectId?: unknown };
    readonly clerk?: unknown;
  };
  readonly plugins?: unknown;
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
  for (const domain of [
    `applinks:${new URL(DEVSKI_IDENTITY.gatewayUrl).hostname}`,
    `webcredentials:${new URL(DEVSKI_IDENTITY.gatewayUrl).hostname}`,
  ]) {
    if (!associatedDomains.includes(domain)) {
      violations.push(`ios.associatedDomains must include ${domain}`);
    }
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
    violations.push("extra.eas must not contain an upstream Expo project identity");
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

    const hasStatefulCommand = STATEFUL_COMMANDS.some((pattern) => pattern.test(workflow.source));
    if (!hasStatefulCommand) {
      continue;
    }

    if (fileName !== "devski-ios-release.yml") {
      violations.push(`${workflow.path} contains a stateful publishing or deployment command`);
      continue;
    }
    if (
      !/^\s*workflow_dispatch:/m.test(workflow.source) ||
      /^\s*(?:push|schedule):/m.test(workflow.source)
    ) {
      violations.push("devski-ios-release.yml must be manually dispatched only");
    }
    if (!/github\.repository\s*==\s*['\"]Onnokh\/t3code['\"]/.test(workflow.source)) {
      violations.push("devski-ios-release.yml must be restricted to the Devski T3 repository");
    }
    if (!/environment:\s*devski-production\b/.test(workflow.source)) {
      violations.push(
        "devski-ios-release.yml must use the protected devski-production environment",
      );
    }
    if (!ALLOWED_RELEASE_COMMAND.test(workflow.source)) {
      violations.push(
        "devski-ios-release.yml may only run the protected Devski iOS build and submit command",
      );
    }
    if (STATEFUL_COMMANDS.slice(1).some((pattern) => pattern.test(workflow.source))) {
      violations.push("devski-ios-release.yml must not contain any additional stateful command");
    }
    if (!/secrets\.DEVSKI_EXPO_TOKEN/.test(workflow.source)) {
      violations.push("devski-ios-release.yml must use the protected DEVSKI_EXPO_TOKEN secret");
    }
  }

  return violations;
}

export function assertWorkflowSourcesAreSafe(workflows: ReadonlyArray<WorkflowSource>): void {
  const violations = findWorkflowSafetyViolations(workflows);
  if (violations.length > 0) {
    throw new Error(`Devski workflow guard failed:\n- ${violations.join("\n- ")}`);
  }
}
