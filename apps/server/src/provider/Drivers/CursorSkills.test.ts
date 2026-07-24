import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverCursorSkills } from "./CursorSkills.ts";

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

it.layer(NodeServices.layer)("discoverCursorSkills", (it) => {
  it.effect("discovers user and project skills with frontmatter metadata", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const homeDir = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");

      yield* writeSkill(
        path.join(homeDir, ".cursor", "skills"),
        "codex-review",
        [
          "---",
          "name: codex-review",
          "description: Ask Codex for a review.",
          "---",
          "",
          "# Body",
        ].join("\n"),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "deploy",
        ["---", "name: deploy", "description: Deploy the app.", "---", "", "# Deploy"].join("\n"),
      );

      const skills = yield* discoverCursorSkills(workspace, homeDir);

      assert.deepEqual(skills, [
        {
          name: "codex-review",
          path: path.join(homeDir, ".cursor", "skills", "codex-review", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "Ask Codex for a review.",
        },
        {
          name: "deploy",
          path: path.join(workspace, ".cursor", "skills", "deploy", "SKILL.md"),
          enabled: true,
          scope: "project",
          description: "Deploy the app.",
        },
      ]);
    }),
  );

  it.effect("follows symlinked skill directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const homeDir = path.join(tempDir, "home");
      const agentsSkills = path.join(homeDir, ".agents", "skills");
      const cursorSkills = path.join(homeDir, ".cursor", "skills");

      yield* writeSkill(
        agentsSkills,
        "linked-skill",
        ["---", "name: linked-skill", "description: Via symlink.", "---"].join("\n"),
      );
      yield* fs.makeDirectory(cursorSkills, { recursive: true });
      yield* fs.symlink(
        path.join(agentsSkills, "linked-skill"),
        path.join(cursorSkills, "linked-skill"),
      );

      const skills = yield* discoverCursorSkills(undefined, homeDir);

      assert.equal(skills.length, 1);
      assert.equal(skills[0]?.name, "linked-skill");
      assert.equal(skills[0]?.description, "Via symlink.");
      assert.equal(skills[0]?.scope, "user");
    }),
  );

  it.effect("prefers project skills over user skills on name collisions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const homeDir = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");

      yield* writeSkill(
        path.join(homeDir, ".cursor", "skills"),
        "deploy",
        ["---", "name: deploy", "description: User deploy.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "deploy",
        ["---", "name: deploy", "description: Project deploy.", "---"].join("\n"),
      );

      const skills = yield* discoverCursorSkills(workspace, homeDir);

      assert.equal(skills.length, 1);
      assert.equal(skills[0]?.scope, "project");
      assert.equal(skills[0]?.description, "Project deploy.");
    }),
  );

  it.effect("returns an empty list when no skill roots exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });

      const skills = yield* discoverCursorSkills(
        path.join(tempDir, "missing-workspace"),
        path.join(tempDir, "missing-home"),
      );

      assert.deepEqual(skills, []);
    }),
  );
});
