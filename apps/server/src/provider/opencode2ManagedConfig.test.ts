// @effect-diagnostics nodeBuiltinImport:off
/**
 * Deployment contract for the devski-code OpenCode 2 configuration.
 *
 * The interactive sidecar (infra/devski-code/Dockerfile.opencode) must:
 *   - carry its operator-owned configuration in this repository, so a rebuilt
 *     container keeps it;
 *   - keep that configuration OUTSIDE the /data/opencode volume, because a
 *     volume mount masks whatever the image puts below it;
 *   - disable the `gitlab` provider, which this deployment cannot use.
 *
 * These tests read the Dockerfile and the configuration so a regression fails
 * in CI instead of on the deployed box.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, it } from "vite-plus/test";

const infraDir = NodePath.resolve(import.meta.dirname, "../../../../infra/devski-code");
const dockerfilePath = NodePath.join(infraDir, "Dockerfile.opencode");
const dockerfile = NodeFS.readFileSync(dockerfilePath, "utf8");
const configPath = NodePath.join(infraDir, "opencode.json");

/** The absolute path the image gives OPENCODE_CONFIG. */
function readManagedConfigPath(): string {
  const match = /^ENV OPENCODE_CONFIG=(\S+)$/m.exec(dockerfile);
  NodeAssert.ok(
    match?.[1],
    "infra/devski-code/Dockerfile.opencode must declare ENV OPENCODE_CONFIG",
  );
  return match[1];
}

describe("devski-code OpenCode 2 managed configuration", () => {
  it("ships the repository configuration into the image", () => {
    const managedPath = readManagedConfigPath();
    NodeAssert.ok(
      NodeFS.existsSync(configPath),
      "infra/devski-code/opencode.json must exist; the image copies it",
    );
    NodeAssert.match(
      dockerfile,
      new RegExp(
        `^COPY infra/devski-code/opencode\\.json ${managedPath.replaceAll("/", "\\/")}$`,
        "m",
      ),
      `the image must COPY infra/devski-code/opencode.json to ${managedPath}`,
    );
  });

  it("keeps the configuration outside the masking volume", () => {
    const managedPath = readManagedConfigPath();
    // VOLUME /data/opencode hides every image file below that path, so a
    // configuration stored there would never reach the running server.
    NodeAssert.ok(
      !managedPath.startsWith("/data/opencode"),
      `OPENCODE_CONFIG ${managedPath} sits under the /data/opencode volume, ` +
        "which masks it at run time",
    );
  });

  it("disables the gitlab provider", () => {
    const config: unknown = JSON.parse(NodeFS.readFileSync(configPath, "utf8"));
    NodeAssert.ok(
      typeof config === "object" && config !== null,
      "infra/devski-code/opencode.json must hold a JSON object",
    );
    const disabled = (config as { readonly disabled_providers?: unknown }).disabled_providers;
    NodeAssert.ok(
      Array.isArray(disabled) && disabled.includes("gitlab"),
      "infra/devski-code/opencode.json must list `gitlab` in disabled_providers; " +
        "this deployment holds no GitLab Duo entitlement and its models cannot serve a Run",
    );
  });
});
