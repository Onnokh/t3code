import { useEffect, useState } from "react";

import { useConnectionController } from "../../features/connection/useConnectionController";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import {
  GATEWAY_UNAVAILABLE_STATE,
  interpretCapabilitiesResponse,
  LOADING_STATE,
  UNPAIRED_STATE,
  type DevskiGatewayState,
} from "./gateway-state";

const CAPABILITIES_TIMEOUT_MS = 5_000;

function capabilitiesUrl(httpBaseUrl: string): string {
  return `${httpBaseUrl.replace(/\/$/, "")}/api/devski/v1/capabilities`;
}

/**
 * Reads Devski capabilities through the paired environment's origin using the
 * same Device Session bearer that Code already holds. A 401 is authoritative:
 * the session expired or was revoked, so the environment is removed and the
 * app returns to pairing (fail closed).
 */
export function useDevskiGateway(): DevskiGatewayState {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const connection = useSavedRemoteConnection(environment?.environmentId ?? null);
  const { removeEnvironment } = useConnectionController();
  const [state, setState] = useState<DevskiGatewayState>(UNPAIRED_STATE);

  useEffect(() => {
    const bearerToken = connection?.bearerToken;
    const httpBaseUrl = connection?.httpBaseUrl;
    if (!bearerToken || !httpBaseUrl) {
      setState(UNPAIRED_STATE);
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CAPABILITIES_TIMEOUT_MS);
    setState(LOADING_STATE);

    void fetch(capabilitiesUrl(httpBaseUrl), {
      headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as unknown;
        return interpretCapabilitiesResponse({
          kind: "response",
          status: response.status,
          body,
        });
      })
      .catch(() => GATEWAY_UNAVAILABLE_STATE)
      .then((nextState) => {
        if (disposed) return;
        if (nextState.kind === "pairing-required" && environment) {
          void removeEnvironment(environment.environmentId);
        }
        setState(nextState);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [connection?.bearerToken, connection?.httpBaseUrl, environment, removeEnvironment]);

  return state;
}
