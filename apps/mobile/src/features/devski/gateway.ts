import { useEffect, useState } from "react";

import { useConnectionController } from "../../features/connection/useConnectionController";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";

export type DevskiServiceStatus = {
  readonly status: "available" | "unavailable";
  readonly reason?: string;
};

export type DevskiCapabilities = {
  readonly session: { readonly expiresAt: string | null };
  readonly capabilities: {
    readonly code: DevskiServiceStatus;
    readonly seo: DevskiServiceStatus;
    readonly automations: DevskiServiceStatus;
    readonly notifications: DevskiServiceStatus;
  };
};

export type DevskiGatewayState =
  | { readonly status: "loading"; readonly capabilities: null; readonly message: string }
  | {
      readonly status: "ready";
      readonly capabilities: DevskiCapabilities;
      readonly message: string;
    }
  | { readonly status: "unavailable"; readonly capabilities: null; readonly message: string };

function gatewayUrl(httpBaseUrl: string): string {
  return `${httpBaseUrl.replace(/\/$/, "")}/api/devski/v1/capabilities`;
}

export function useDevskiGateway(): DevskiGatewayState {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const { removeEnvironment } = useConnectionController();
  const [state, setState] = useState<DevskiGatewayState>({
    status: "unavailable",
    capabilities: null,
    message: "Pair this device through Code to use Devski services.",
  });

  useEffect(() => {
    const bearerToken = connection?.bearerToken;
    const httpBaseUrl = connection?.httpBaseUrl;
    if (!bearerToken || !httpBaseUrl) {
      setState({
        status: "unavailable",
        capabilities: null,
        message: "Pair this device through Code to use Devski services.",
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    setState({ status: "loading", capabilities: null, message: "Checking Devski services…" });

    void fetch(gatewayUrl(httpBaseUrl), {
      headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(response.status === 401 ? "pairing_required" : "unavailable");
        return (await response.json()) as DevskiCapabilities;
      })
      .then((capabilities) => {
        setState({ status: "ready", capabilities, message: "Device Session is active." });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "pairing_required" && environment) {
          void removeEnvironment(environment.environmentId);
        }
        setState({
          status: "unavailable",
          capabilities: null,
          message:
            error instanceof Error && error.message === "pairing_required"
              ? "This Device Session expired. Pair this device again through Code."
              : "The Devski Gateway is unavailable right now.",
        });
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [connection?.bearerToken, connection?.httpBaseUrl, environment, removeEnvironment]);

  return state;
}
