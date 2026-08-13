// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Release guard runs as a host-side Node CLI.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import {
  assertDevskiConfigIsSafe,
  assertDevskiEasConfigIsSafe,
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
console.log("Devski production Expo/EAS config and publishing workflows are release-safe.");
