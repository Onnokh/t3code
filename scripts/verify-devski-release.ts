// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Release guard runs as a host-side Node CLI.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import { DEVSKI_IDENTITY } from "./lib/devski-identity.ts";
import {
  assertDevskiConfigIsSafe,
  assertDevskiEasConfigIsSafe,
  assertNativeIosSigningIsSafe,
  assertWorkflowSourcesAreSafe,
  type ResolvedEasConfig,
  type ResolvedExpoConfig,
  type WorkflowSource,
} from "./lib/devski-release-safety.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const mobileRoot = NodePath.join(repoRoot, "apps/mobile");

const resolvedConfig = JSON.parse(
  NodeChildProcess.execFileSync("pnpm", ["exec", "expo", "config", "--json", "--type", "public"], {
    cwd: mobileRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
) as ResolvedExpoConfig;

assertDevskiConfigIsSafe(resolvedConfig);

const easConfig = JSON.parse(
  NodeFS.readFileSync(NodePath.join(mobileRoot, "eas.json"), "utf8"),
) as ResolvedEasConfig;
assertDevskiEasConfigIsSafe(easConfig);

const workflowsRoot = NodePath.join(repoRoot, ".github/workflows");
const workflows: WorkflowSource[] = NodeFS.readdirSync(workflowsRoot)
  .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
  .map((fileName) => ({
    path: NodePath.join(".github/workflows", fileName),
    source: NodeFS.readFileSync(NodePath.join(workflowsRoot, fileName), "utf8"),
  }));

assertWorkflowSourcesAreSafe(workflows);

// The generated Xcode project only exists after a prebuild, and a Personal
// Team prebuild carries another bundle identifier and may sign with its own
// team. Both cases report and continue instead of failing CI.
const nativeProjectPaths = findNativeIosProjectPaths(NodePath.join(mobileRoot, "ios"));
let checkedNativeProjects = 0;
for (const nativeProjectPath of nativeProjectPaths) {
  const path = NodePath.relative(repoRoot, nativeProjectPath);
  const source = NodeFS.readFileSync(nativeProjectPath, "utf8");
  if (!source.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${DEVSKI_IDENTITY.iosBundleIdentifier}`)) {
    console.log(`Skipping ${path}: it was prebuilt for another bundle identifier.`);
    continue;
  }
  assertNativeIosSigningIsSafe({ path, source });
  checkedNativeProjects += 1;
}
if (nativeProjectPaths.length === 0) {
  console.log("Skipping the native iOS signing check: apps/mobile/ios is not prebuilt.");
} else if (checkedNativeProjects > 0) {
  console.log(
    `Every target in ${checkedNativeProjects} generated Xcode project signs with the Devski Apple team.`,
  );
}

console.log("Devski production Expo/EAS config and publishing workflows are release-safe.");

function findNativeIosProjectPaths(iosRoot: string): ReadonlyArray<string> {
  if (!NodeFS.existsSync(iosRoot)) {
    return [];
  }
  return NodeFS.readdirSync(iosRoot)
    .filter((entry) => entry.endsWith(".xcodeproj"))
    .map((entry) => NodePath.join(iosRoot, entry, "project.pbxproj"))
    .filter((pbxprojPath) => NodeFS.existsSync(pbxprojPath));
}
