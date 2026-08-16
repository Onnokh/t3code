import { useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useSavedRemoteConnection } from "../../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../../state/workspace";
import {
  interpretDevicesResponse,
  readDevices,
  readRevocation,
  type DevicesResult,
  type PairedDevice,
} from "./devices-state";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Typed client for the Gateway device management contract (PLO-421). Every
 * call presents the paired Device Session bearer; the client can only name
 * opaque session ids. Revocation and sign-out are server-authoritative —
 * there is no offline queue and no local pre-emption of the server answer.
 */
export type DevicesClient = {
  readonly listDevices: () => Promise<DevicesResult<PairedDevice[]>>;
  /** Revokes another Paired Device. The server refuses the current one. */
  readonly revokeDevice: (sessionId: string) => Promise<DevicesResult<{ revoked: boolean }>>;
  /** Revokes the calling Device Session ("Sign out this device"). */
  readonly signOut: () => Promise<DevicesResult<{ revoked: boolean }>>;
};

export function createDevicesClient(baseUrl: string, bearerToken: string): DevicesClient {
  const origin = baseUrl.replace(/\/$/, "");

  async function call<T>(
    path: string,
    readValue: (body: unknown) => T | null,
    init?: RequestInit,
  ): Promise<DevicesResult<T>> {
    try {
      const response = await fetch(`${origin}/api/devski/v1/devices${path}`, {
        ...init,
        headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      return interpretDevicesResponse(
        { kind: "response", status: response.status, body },
        readValue,
      );
    } catch {
      return interpretDevicesResponse({ kind: "network-error" }, readValue);
    }
  }

  return {
    listDevices: () => call("", readDevices),
    revokeDevice: (sessionId) =>
      call(`/${encodeURIComponent(sessionId)}/revoke`, readRevocation, { method: "POST" }),
    signOut: () => call("/sign-out", readRevocation, { method: "POST" }),
  };
}

/**
 * Resolves the devices client for the paired environment, or null while
 * this device is unpaired. Uses the same Device Session bearer that Code,
 * SEO, and Automations already hold.
 */
export function useDevicesClient(): {
  readonly client: DevicesClient;
  readonly environmentId: EnvironmentId;
} | null {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const environmentId = environment?.environmentId ?? null;
  const connection = useSavedRemoteConnection(environmentId);
  const bearerToken = connection?.bearerToken;
  const httpBaseUrl = connection?.httpBaseUrl;

  return useMemo(() => {
    if (!bearerToken || !httpBaseUrl || !environmentId) return null;
    return { client: createDevicesClient(httpBaseUrl, bearerToken), environmentId };
  }, [bearerToken, httpBaseUrl, environmentId]);
}
