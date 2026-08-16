import { describe, expect, it } from "@effect/vitest";

import { projectAgentRuntimeHealth, type AgentRuntimeSnapshotLike } from "./agentRuntimeHealth.ts";

function snapshot(
  driver: string,
  status: AgentRuntimeSnapshotLike["status"],
  overrides: Partial<AgentRuntimeSnapshotLike> = {},
): AgentRuntimeSnapshotLike {
  return { driver, enabled: true, status, ...overrides };
}

describe("projectAgentRuntimeHealth", () => {
  it("reports unconfigured runtimes when no snapshot exists", () => {
    expect(projectAgentRuntimeHealth([])).toEqual({
      claude: "unconfigured",
      opencode2: "unconfigured",
    });
  });

  it("separates a Claude failure from a healthy OpenCode 2 runtime", () => {
    const health = projectAgentRuntimeHealth([
      snapshot("claudeAgent", "error"),
      snapshot("opencode2", "ready"),
    ]);
    expect(health).toEqual({ claude: "error", opencode2: "ready" });
  });

  it("separates an OpenCode 2 failure from a healthy Claude runtime", () => {
    const health = projectAgentRuntimeHealth([
      snapshot("claudeAgent", "ready"),
      snapshot("opencode2", "error"),
    ]);
    expect(health).toEqual({ claude: "ready", opencode2: "error" });
  });

  it("lets the healthiest instance answer for a driver with several instances", () => {
    const health = projectAgentRuntimeHealth([
      snapshot("opencode2", "error"),
      snapshot("opencode2", "ready"),
    ]);
    expect(health.opencode2).toBe("ready");
  });

  it("reports a disabled instance as disabled regardless of its probe status", () => {
    const health = projectAgentRuntimeHealth([
      snapshot("claudeAgent", "ready", { enabled: false }),
    ]);
    expect(health.claude).toBe("disabled");
  });

  it("ignores unavailable shadow snapshots and unrelated drivers", () => {
    const health = projectAgentRuntimeHealth([
      snapshot("claudeAgent", "ready", { availability: "unavailable" }),
      snapshot("codex", "ready"),
    ]);
    expect(health).toEqual({ claude: "unconfigured", opencode2: "unconfigured" });
  });
});
