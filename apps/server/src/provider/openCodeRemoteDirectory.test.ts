import { describe, expect, it } from "vite-plus/test";

import { resolveOpenCodeRemoteDirectory } from "./openCodeRemoteDirectory.ts";

const remoteSettings = (overrides?: {
  readonly serverUrl?: string;
  readonly workingDirectory?: string;
  readonly localDirectoryRoot?: string;
  readonly remoteDirectoryRoot?: string;
}) => ({
  serverUrl: "http://plowski.example:4096",
  workingDirectory: "",
  localDirectoryRoot: "",
  remoteDirectoryRoot: "",
  ...overrides,
});

describe("resolveOpenCodeRemoteDirectory", () => {
  it("keeps the local cwd when no server URL is configured", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/Users/onnokh/dev/sites/sleevy",
        remoteSettings({ serverUrl: "", workingDirectory: "/data/workspace" }),
      ),
    ).toBe("/Users/onnokh/dev/sites/sleevy");
  });

  it("maps basename under workingDirectory for remote servers", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/Users/onnokh/dev/sites/sleevy",
        remoteSettings({ workingDirectory: "/data/workspace" }),
      ),
    ).toBe("/data/workspace/sleevy");
  });

  it("prefers workingDirectory over local/remote root mapping", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/Users/onnokh/dev/sites/sleevy",
        remoteSettings({
          workingDirectory: "/data/workspace",
          localDirectoryRoot: "/Users/onnokh/dev/sites",
          remoteDirectoryRoot: "/other",
        }),
      ),
    ).toBe("/data/workspace/sleevy");
  });

  it("maps a local prefix onto remoteDirectoryRoot", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/Users/onnokh/dev/sites/sleevy",
        remoteSettings({
          localDirectoryRoot: "/Users/onnokh/dev/sites",
          remoteDirectoryRoot: "/data/workspace",
        }),
      ),
    ).toBe("/data/workspace/sleevy");
  });

  it("maps the local root itself onto the remote root", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/Users/onnokh/dev/sites",
        remoteSettings({
          localDirectoryRoot: "/Users/onnokh/dev/sites",
          remoteDirectoryRoot: "/data/workspace",
        }),
      ),
    ).toBe("/data/workspace");
  });

  it("falls back to remote root + basename when local root does not match", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/tmp/other/sleevy",
        remoteSettings({
          localDirectoryRoot: "/Users/onnokh/dev/sites",
          remoteDirectoryRoot: "/data/workspace",
        }),
      ),
    ).toBe("/data/workspace/sleevy");
  });

  it("keeps the local cwd when remote mapping fields are empty", () => {
    expect(resolveOpenCodeRemoteDirectory("/Users/onnokh/dev/sites/sleevy", remoteSettings())).toBe(
      "/Users/onnokh/dev/sites/sleevy",
    );
  });

  it("uses the project folder name for PLOW/T3 worktree checkouts", () => {
    expect(
      resolveOpenCodeRemoteDirectory(
        "/Users/onnokh/.plowcode/worktrees/sleevy/t3code-9b65e066",
        remoteSettings({ workingDirectory: "/data/workspace" }),
      ),
    ).toBe("/data/workspace/sleevy");
  });
});
