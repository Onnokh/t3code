/**
 * OpenCode2Provider — status probe and live model/agent inventory for the
 * bounded external-server OpenCode 2 provider.
 *
 * The inventory comes straight from the pinned `/api` service contract
 * (`model.list`, `model.default`, `agent.list`) — never from a CLI parser
 * or the legacy SDK. A server on a different build than the pinned client
 * is reported as an error state instead of being used.
 */
import {
  type ModelCapabilities,
  type OpenCode2Settings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type { Agent, Model, OpenCodeClient } from "@opencode-ai/client/effect";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import { createModelCapabilities } from "@t3tools/shared/model";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  makeOpenCode2Client,
  OPENCODE2_PINNED_VERSION,
  openCode2FailureDetail,
  runOpenCode2,
} from "../opencode2Runtime.ts";

const OPENCODE2_PRESENTATION = {
  displayName: "OpenCode 2",
  showInteractionModeToggle: false,
} as const;

const DEFAULT_OPENCODE2_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export interface OpenCode2Inventory {
  readonly models: ReadonlyArray<Model.Info>;
  readonly defaultModel: Model.Info | undefined;
  readonly agents: ReadonlyArray<Agent.Info>;
  readonly serverVersion: string;
}

function titleCaseSlug(value: string): string {
  const segments: Array<string> = [];
  for (const segment of value.split(/[-_/]+/)) {
    if (segment.length > 0) {
      segments.push(segment.charAt(0).toUpperCase() + segment.slice(1));
    }
  }
  return segments.join(" ");
}

function inferDefaultAgent(agents: ReadonlyArray<Agent.Info>): string | undefined {
  return agents.find((agent) => agent.id === "build")?.id ?? agents[0]?.id ?? undefined;
}

function openCode2CapabilitiesForModel(input: {
  readonly model: Model.Info;
  readonly agents: ReadonlyArray<Agent.Info>;
}): ModelCapabilities {
  const variantValues = input.model.variants.map((variant) => variant.id as string);
  const defaultVariant = variantValues.length === 1 ? variantValues[0] : undefined;
  const variantOptions = variantValues.map((value) =>
    defaultVariant === value
      ? { id: value, label: titleCaseSlug(value), isDefault: true as const }
      : { id: value, label: titleCaseSlug(value) },
  );
  const primaryAgents = input.agents.filter(
    (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
  );
  const defaultAgent = inferDefaultAgent(primaryAgents);
  const agentOptions = primaryAgents.map((agent) =>
    defaultAgent === agent.id
      ? {
          id: agent.id as string,
          label: titleCaseSlug(agent.name as string),
          isDefault: true as const,
        }
      : { id: agent.id as string, label: titleCaseSlug(agent.name as string) },
  );
  return createModelCapabilities({
    optionDescriptors: [
      ...(variantOptions.length > 0
        ? [
            {
              id: "variant",
              label: "Variant",
              type: "select" as const,
              options: variantOptions,
              ...(defaultVariant ? { currentValue: defaultVariant } : {}),
            },
          ]
        : []),
      ...(agentOptions.length > 0
        ? [
            {
              id: "agent",
              label: "Agent",
              type: "select" as const,
              options: agentOptions,
              ...(defaultAgent ? { currentValue: defaultAgent } : {}),
            },
          ]
        : []),
    ],
  });
}

export function flattenOpenCode2Models(
  inventory: Pick<OpenCode2Inventory, "models" | "defaultModel" | "agents">,
): ReadonlyArray<ServerProviderModel> {
  const models: Array<ServerProviderModel> = [];
  for (const model of inventory.models) {
    if (!model.enabled) continue;
    const name = nonEmptyTrimmed(model.name) ?? `${model.providerID}/${model.modelID}`;
    const isDefault =
      inventory.defaultModel !== undefined &&
      inventory.defaultModel.providerID === model.providerID &&
      inventory.defaultModel.modelID === model.modelID;
    models.push({
      slug: `${model.providerID}/${model.modelID}`,
      name,
      subProvider: model.providerID,
      isCustom: false,
      ...(isDefault ? { isDefault: true } : {}),
      capabilities: openCode2CapabilitiesForModel({ model, agents: inventory.agents }),
    });
  }
  return models.toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Load the live inventory through the pinned service contract. */
export const loadOpenCode2Inventory = Effect.fn("loadOpenCode2Inventory")(function* (
  client: OpenCodeClient,
  directory: string,
) {
  const location = { location: { directory } };
  const health = yield* runOpenCode2("health.get", client.health.get());
  if (health.version !== OPENCODE2_PINNED_VERSION) {
    return yield* Effect.fail(
      new OpenCode2VersionMismatch({
        serverVersion: health.version,
      }),
    );
  }
  const [models, defaultModel, agents] = yield* Effect.all(
    [
      runOpenCode2("model.list", client.model.list(location)),
      runOpenCode2("model.default", client.model.default(location)),
      runOpenCode2("agent.list", client.agent.list(location)),
    ],
    { concurrency: "unbounded" },
  );
  return {
    models: models.data,
    defaultModel: defaultModel.data,
    agents: agents.data,
    serverVersion: health.version,
  } satisfies OpenCode2Inventory;
});

export class OpenCode2VersionMismatch {
  readonly _tag = "OpenCode2VersionMismatch";
  readonly serverVersion: string;
  constructor(input: { readonly serverVersion: string }) {
    this.serverVersion = input.serverVersion;
  }
}

export const makePendingOpenCode2Provider = (
  settings: OpenCode2Settings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      [],
      settings.customModels,
      DEFAULT_OPENCODE2_MODEL_CAPABILITIES,
    );
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: OPENCODE2_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "OpenCode 2 is disabled in T3 Code settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: OPENCODE2_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "OpenCode 2 provider status has not been checked in this session yet.",
      },
    });
  });

export const checkOpenCode2ProviderStatus = Effect.fn("checkOpenCode2ProviderStatus")(function* (
  settings: OpenCode2Settings,
  fallbackDirectory: string,
): Effect.fn.Return<ServerProviderDraft, never, HttpClient.HttpClient> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const customModels = settings.customModels;
  const serverUrl = settings.serverUrl.trim();

  const failed = (message: string, version: string | null = null) =>
    buildServerProvider({
      presentation: OPENCODE2_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE2_MODEL_CAPABILITIES),
      probe: {
        installed: version !== null,
        version,
        status: "error",
        auth: { status: "unknown" },
        message,
      },
    });

  if (!settings.enabled) {
    return buildServerProvider({
      presentation: OPENCODE2_PRESENTATION,
      enabled: false,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE2_MODEL_CAPABILITIES),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "OpenCode 2 is disabled in T3 Code settings.",
      },
    });
  }

  if (serverUrl.length === 0) {
    return buildServerProvider({
      presentation: OPENCODE2_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE2_MODEL_CAPABILITIES),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message:
          "No OpenCode 2 server URL is configured. The opencode2 provider is external-server only.",
      },
    });
  }

  // The probe directory travels to the external server, so it has to be a
  // path that server can resolve. This server's own cwd is not: with T3 and
  // OpenCode in separate containers only the Code Workspace Root is mounted
  // on both sides, and OpenCode answers 500 for a directory it cannot see.
  // The configured root is the one path both are guaranteed to share; cwd
  // stays the fallback for a single-machine install that configured none.
  const probeDirectory = settings.workspaceRoot.trim() || fallbackDirectory;

  const inventoryExit = yield* Effect.exit(
    Effect.gen(function* () {
      const client = yield* makeOpenCode2Client({
        serverUrl,
        ...(settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
      });
      return yield* loadOpenCode2Inventory(client, probeDirectory);
    }),
  );

  if (inventoryExit._tag === "Failure") {
    const cause = Cause.squash(inventoryExit.cause);
    if (
      cause !== null &&
      typeof cause === "object" &&
      (cause as { readonly _tag?: unknown })._tag === "OpenCode2VersionMismatch"
    ) {
      const mismatch = cause as OpenCode2VersionMismatch;
      return failed(
        `OpenCode 2 server build '${mismatch.serverVersion}' does not match the pinned client build '${OPENCODE2_PINNED_VERSION}'. Update server and client together.`,
        mismatch.serverVersion,
      );
    }
    return failed(openCode2FailureDetail(cause));
  }

  const inventory = inventoryExit.value;
  const models = providerModelsFromSettings(
    flattenOpenCode2Models(inventory),
    customModels,
    DEFAULT_OPENCODE2_MODEL_CAPABILITIES,
  );
  const liveModelCount = flattenOpenCode2Models(inventory).length;
  return buildServerProvider({
    presentation: OPENCODE2_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: inventory.serverVersion,
      status: liveModelCount > 0 ? "ready" : "warning",
      auth: {
        status: liveModelCount > 0 ? "authenticated" : "unknown",
        type: "opencode",
      },
      message:
        liveModelCount > 0
          ? `${liveModelCount} model${liveModelCount === 1 ? "" : "s"} available through the pinned OpenCode 2 server.`
          : "Connected to the pinned OpenCode 2 server, but it did not report any available models.",
    },
  });
});
