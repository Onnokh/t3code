/**
 * agentRuntimeHealth — per-Agent-Runtime health projection for the private
 * `GET /healthz/agent-runtimes` probe.
 *
 * The Devski Gateway must distinguish a Claude runtime failure from an
 * interactive OpenCode 2 failure (and both from a whole-T3 failure) in its
 * readiness and capability surfaces. This projection reduces the provider
 * snapshots that already carry per-runtime install/auth/version state to one
 * status enum per Devski Agent Runtime. It deliberately exposes no versions,
 * messages, accounts, or credentials: the endpoint is an unauthenticated
 * health probe on the private port and must stay information-poor.
 *
 * @module agentRuntimeHealth
 */

export type AgentRuntimeHealthStatus = "ready" | "warning" | "error" | "disabled" | "unconfigured";

export interface AgentRuntimeHealth {
  readonly claude: AgentRuntimeHealthStatus;
  readonly opencode2: AgentRuntimeHealthStatus;
}

/**
 * The structural subset of `ServerProvider` this projection reads. Keeping
 * the input narrow lets tests build fixtures without satisfying the whole
 * wire schema.
 */
export interface AgentRuntimeSnapshotLike {
  readonly driver: string;
  readonly enabled: boolean;
  readonly status: "ready" | "warning" | "error" | "disabled";
  readonly availability?: "available" | "unavailable" | undefined;
}

const CLAUDE_DRIVER = "claudeAgent";
const OPENCODE2_DRIVER = "opencode2";

// Lower is healthier. With several instances of one driver the healthiest
// one answers for the runtime: one broken extra instance must not report the
// whole Agent Runtime as failed while a working default instance exists.
const STATUS_PRIORITY: Record<AgentRuntimeSnapshotLike["status"], number> = {
  ready: 0,
  warning: 1,
  error: 2,
  disabled: 3,
};

function runtimeStatus(
  providers: ReadonlyArray<AgentRuntimeSnapshotLike>,
  driver: string,
): AgentRuntimeHealthStatus {
  const snapshots = providers.filter(
    (provider) => provider.driver === driver && provider.availability !== "unavailable",
  );
  if (snapshots.length === 0) {
    return "unconfigured";
  }

  let best: AgentRuntimeSnapshotLike["status"] | null = null;
  for (const snapshot of snapshots) {
    const status = snapshot.enabled ? snapshot.status : "disabled";
    if (best === null || STATUS_PRIORITY[status] < STATUS_PRIORITY[best]) {
      best = status;
    }
  }
  return best ?? "unconfigured";
}

export function projectAgentRuntimeHealth(
  providers: ReadonlyArray<AgentRuntimeSnapshotLike>,
): AgentRuntimeHealth {
  return {
    claude: runtimeStatus(providers, CLAUDE_DRIVER),
    opencode2: runtimeStatus(providers, OPENCODE2_DRIVER),
  };
}
