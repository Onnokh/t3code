/**
 * OpenCodeSkills — filesystem discovery of OpenCode skills for the `$` picker.
 *
 * OpenCode loads skills from global/project `skill`/`skills` directories (and a
 * few shared agent roots). The local CLI inventory path does not expose skills,
 * so provider status scans these locations when the SDK inventory is empty.
 *
 * @module provider/Drivers/OpenCodeSkills
 */
import * as NodeOS from "node:os";

import type { ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

type OpenCodeSkillScope = "user" | "project";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "parsed"; readonly name?: string; readonly description?: string };

function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { kind: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed" };
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return {
    kind: "parsed",
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * Enumerate OpenCode skill roots. Later roots overwrite earlier ones on name
 * collision so project scope wins over user/shared roots.
 */
export const discoverOpenCodeSkills = Effect.fn("discoverOpenCodeSkills")(function* (
  cwd?: string,
  environment?: NodeJS.ProcessEnv,
  homeDir?: string,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = environment ?? process.env;
  const resolvedHome = homeDir ?? NodeOS.homedir();
  const configuredConfigHome = env.XDG_CONFIG_HOME?.trim();
  const configHome =
    configuredConfigHome && configuredConfigHome.length > 0
      ? path.resolve(configuredConfigHome)
      : path.join(resolvedHome, ".config");

  const roots: ReadonlyArray<{ directory: string; scope: OpenCodeSkillScope }> = [
    { directory: path.join(resolvedHome, ".agents", "skills"), scope: "user" },
    { directory: path.join(resolvedHome, ".claude", "skills"), scope: "user" },
    { directory: path.join(configHome, "opencode", "skill"), scope: "user" },
    { directory: path.join(configHome, "opencode", "skills"), scope: "user" },
    ...(cwd
      ? ([
          { directory: path.join(cwd, ".opencode", "skill"), scope: "project" },
          { directory: path.join(cwd, ".opencode", "skills"), scope: "project" },
        ] as const)
      : []),
  ];

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const root of roots) {
    const entries = yield* fileSystem
      .readDirectory(root.directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    for (const entry of [...entries].sort()) {
      // readFileString follows directory symlinks (shared ~/.agents skills, etc.).
      const skillPath = path.join(root.directory, entry, "SKILL.md");
      const contents = yield* fileSystem
        .readFileString(skillPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) {
        continue;
      }

      const frontmatter = parseSkillFrontmatter(contents);
      if (frontmatter.kind === "malformed") {
        continue;
      }

      const name = (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ?? entry.trim();
      if (!name) {
        continue;
      }

      const description =
        frontmatter.kind === "parsed" && frontmatter.description
          ? frontmatter.description
          : undefined;
      skillsByName.set(name, {
        name,
        path: skillPath,
        enabled: true,
        scope: root.scope,
        ...(description ? { description, shortDescription: description } : {}),
      });
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
