// Renders the OpenCode 2 sidecar's configuration from the service's one
// declaration of what an agent can reach (agent-tools.json), which the T3
// environment's Claude runtime applies at boot from the same file.
//
//   bun infra/devski-code/render-opencode-config.mjs <declaration> <output>
//
// Run at image build time, so the rendered file is versioned by the image and
// lands outside /data/opencode — that path is a volume, and a mount masks
// whatever the image put below it.
import { readFileSync, writeFileSync } from "node:fs";

const [declarationPath, outputPath] = process.argv.slice(2);
if (!declarationPath || !outputPath) {
  console.error("usage: render-opencode-config.mjs <declaration> <output>");
  process.exit(2);
}

const declaration = JSON.parse(readFileSync(declarationPath, "utf8"));

// OpenCode calls an HTTP MCP server "remote". The declaration uses the
// transport name from the MCP specification, which is what Claude Code takes.
const servers = Object.fromEntries(
  Object.entries(declaration.mcpServers ?? {}).map(([name, server]) => [
    name,
    { ...server, type: server.type === "http" ? "remote" : server.type },
  ]),
);

const config = {
  $schema: "https://opencode.ai/config.json",
  // Runtime-specific keys the declaration carries for this runtime only, such
  // as the disabled `gitlab` provider.
  ...(declaration.opencode ?? {}),
  skills: declaration.skills ?? [],
  ...(Object.keys(servers).length > 0 ? { mcp: { servers } } : {}),
};

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`rendered ${outputPath} from ${declarationPath}`);
