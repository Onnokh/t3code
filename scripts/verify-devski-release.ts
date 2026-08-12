// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Release guard runs as a host-side Node CLI.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { execFileSync } from "node:child_process";

import {
  assertDevskiConfigIsSafe,
  assertWorkflowSourcesAreSafe,
  type ResolvedExpoConfig,
  type WorkflowSource,
} from "./lib/devski-release-safety.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const mobileRoot = NodePath.join(repoRoot, "apps/mobile");

const resolvedConfig = JSON.parse(
  execFileSync("pnpm", ["exec", "expo", "config", "--json", "--type", "public"], {
    cwd: mobileRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
) as ResolvedExpoConfig;

assertDevskiConfigIsSafe(resolvedConfig);

const workflowsRoot = NodePath.join(repoRoot, ".github/workflows");
const workflows: WorkflowSource[] = NodeFS.readdirSync(workflowsRoot)
  .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
  .map((fileName) => ({
    path: NodePath.join(".github/workflows", fileName),
    source: NodeFS.readFileSync(NodePath.join(workflowsRoot, fileName), "utf8"),
  }));

assertWorkflowSourcesAreSafe(workflows);
console.log("Devski production config and publishing workflows are release-safe.");
