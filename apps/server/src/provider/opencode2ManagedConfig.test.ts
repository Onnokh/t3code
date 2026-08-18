// @effect-diagnostics nodeBuiltinImport:off
/**
 * Deployment contract for the devski-code OpenCode 2 configuration.
 *
 * The interactive sidecar (infra/devski-code/Dockerfile.opencode) must:
 *   - derive its operator-owned configuration from this repository, so a
 *     rebuilt container keeps it;
 *   - keep that configuration OUTSIDE the /data/opencode volume, because a
 *     volume mount masks whatever the image puts below it;
 *   - disable the `gitlab` provider, which this deployment cannot use.
 *
 * The configuration is no longer a file of its own: infra/devski-code/agent-tools.json
 * is the service's one declaration of what an agent can reach, shared with the
 * Claude runtime, and the image renders the OpenCode view of it at build time.
 * These tests read the Dockerfile and run that render, so a regression fails in
 * CI instead of on the deployed box.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, it } from "vite-plus/test";

const infraDir = NodePath.resolve(import.meta.dirname, "../../../../infra/devski-code");
const dockerfilePath = NodePath.join(infraDir, "Dockerfile.opencode");
const dockerfile = NodeFS.readFileSync(dockerfilePath, "utf8");
const declarationPath = NodePath.join(infraDir, "agent-tools.json");
const rendererPath = NodePath.join(infraDir, "render-opencode-config.mjs");

/** The absolute path the image gives OPENCODE_CONFIG. */
function readManagedConfigPath(): string {
  const match = /^ENV OPENCODE_CONFIG=(\S+)$/m.exec(dockerfile);
  NodeAssert.ok(
    match?.[1],
    "infra/devski-code/Dockerfile.opencode must declare ENV OPENCODE_CONFIG",
  );
  return match[1];
}

/** The configuration the image writes, produced by the image's own renderer. */
function renderManagedConfig(): Record<string, unknown> {
  const outputPath = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "devski-opencode-config-")),
    "opencode.json",
  );
  const rendered = NodeChildProcess.spawnSync(
    process.execPath,
    [rendererPath, declarationPath, outputPath],
    { encoding: "utf8" },
  );
  NodeAssert.equal(
    rendered.status,
    0,
    `render-opencode-config.mjs failed: ${rendered.stderr || rendered.stdout}`,
  );
  const config: unknown = JSON.parse(NodeFS.readFileSync(outputPath, "utf8"));
  NodeAssert.ok(
    typeof config === "object" && config !== null && !Array.isArray(config),
    "the renderer must produce a JSON object",
  );
  return config as Record<string, unknown>;
}

describe("devski-code OpenCode 2 managed configuration", () => {
  it("renders the repository declaration into the image", () => {
    const managedPath = readManagedConfigPath();
    NodeAssert.ok(
      NodeFS.existsSync(declarationPath),
      "infra/devski-code/agent-tools.json must exist; both runtimes read it",
    );
    NodeAssert.match(
      dockerfile,
      /^COPY infra\/devski-code\/agent-tools\.json \S+$/m,
      "the image must COPY infra/devski-code/agent-tools.json",
    );
    NodeAssert.match(
      dockerfile,
      new RegExp(`${managedPath.replaceAll("/", "\\/")}`),
      `the image must render the declaration to ${managedPath}`,
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
    const disabled = renderManagedConfig().disabled_providers;
    NodeAssert.ok(
      Array.isArray(disabled) && disabled.includes("gitlab"),
      "the rendered configuration must list `gitlab` in disabled_providers; " +
        "this deployment holds no GitLab Duo entitlement and its models cannot serve a Run",
    );
  });

  it("carries the declared skills and MCP servers into the OpenCode shape", () => {
    const config = renderManagedConfig();
    const declaration: unknown = JSON.parse(NodeFS.readFileSync(declarationPath, "utf8"));
    NodeAssert.ok(typeof declaration === "object" && declaration !== null);
    const declared = declaration as {
      readonly skills?: unknown;
      readonly mcpServers?: Record<string, { readonly url?: string; readonly type?: string }>;
    };

    NodeAssert.deepEqual(
      config.skills,
      declared.skills,
      "every skill directory the declaration names must reach the sidecar",
    );

    // OpenCode calls an HTTP MCP server "remote". Getting this wrong leaves the
    // server declared and unusable, which is the failure this render exists to
    // prevent: the Claude runtime takes the same declaration untranslated.
    const servers = (config.mcp as { readonly servers?: Record<string, unknown> } | undefined)
      ?.servers;
    NodeAssert.ok(servers, "the rendered configuration must declare mcp.servers");
    for (const [name, declaredServer] of Object.entries(declared.mcpServers ?? {})) {
      const rendered = servers[name] as { readonly type?: string; readonly url?: string };
      NodeAssert.ok(rendered, `MCP server ${name} must reach the sidecar`);
      NodeAssert.equal(rendered.url, declaredServer.url);
      NodeAssert.equal(
        rendered.type,
        declaredServer.type === "http" ? "remote" : declaredServer.type,
      );
    }
  });
});
