import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverOpenCodeSkills } from "./OpenCodeSkills.ts";

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
});

it.layer(NodeServices.layer)("discoverOpenCodeSkills", (it) => {
  it.effect("discovers global and project skills, preferring project on collision", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-skills-" });
      const homeDir = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");
      const configHome = path.join(homeDir, ".config");

      yield* writeSkill(
        path.join(configHome, "opencode", "skills"),
        "deploy",
        ["---", "name: deploy", "description: User deploy.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(workspace, ".opencode", "skill"),
        "deploy",
        ["---", "name: deploy", "description: Project deploy.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(homeDir, ".agents", "skills"),
        "shared-skill",
        ["---", "name: shared-skill", "description: Shared agent skill.", "---"].join("\n"),
      );

      const skills = yield* discoverOpenCodeSkills(
        workspace,
        { XDG_CONFIG_HOME: configHome },
        homeDir,
      );

      assert.deepEqual(
        skills.map((skill) => ({
          name: skill.name,
          scope: skill.scope,
          description: skill.description,
        })),
        [
          {
            name: "deploy",
            scope: "project",
            description: "Project deploy.",
          },
          {
            name: "shared-skill",
            scope: "user",
            description: "Shared agent skill.",
          },
        ],
      );
    }),
  );

  it.effect("follows symlinked skill directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-skills-" });
      const homeDir = path.join(tempDir, "home");
      const agentsSkills = path.join(homeDir, ".agents", "skills");
      const configSkills = path.join(homeDir, ".config", "opencode", "skills");

      yield* writeSkill(
        agentsSkills,
        "linked-skill",
        ["---", "name: linked-skill", "description: Via symlink.", "---"].join("\n"),
      );
      yield* fs.makeDirectory(configSkills, { recursive: true });
      yield* fs.symlink(
        path.join(agentsSkills, "linked-skill"),
        path.join(configSkills, "linked-skill"),
      );

      const skills = yield* discoverOpenCodeSkills(
        undefined,
        { XDG_CONFIG_HOME: path.join(homeDir, ".config") },
        homeDir,
      );

      assert.equal(
        skills.some((skill) => skill.name === "linked-skill"),
        true,
      );
    }),
  );
});
