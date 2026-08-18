import { useEffect, useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  loadDevskiReadCache,
  removeDevskiReadCache,
  saveDevskiReadCache,
} from "../../persistence/imperative";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import {
  devskiCacheFingerprint,
  openDevskiCacheSession,
  setDevskiCacheStore,
} from "./devski-read-cache";

/**
 * Puts the Devski read cache in the client cache database, beside the shell
 * and thread snapshots the Code Area already keeps there. Nothing new is
 * installed for it: the record is keyed by environment, so unpairing an
 * environment removes the Devski snapshot with the rest of that
 * environment's cached data.
 */
setDevskiCacheStore({
  load: (environmentId) => loadDevskiReadCache(environmentId as EnvironmentId),
  save: (environmentId, payload) => saveDevskiReadCache(environmentId as EnvironmentId, payload),
  remove: (environmentId) => removeDevskiReadCache(environmentId as EnvironmentId),
});

export type DevskiConnection = {
  readonly environmentId: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
};

/**
 * The paired environment's Devski connection, or null while this device is
 * unpaired, with the read cache pointed at that Session.
 *
 * Every Area resolves its client through here, so the cache follows the
 * credential in one place: a different environment or a re-issued credential
 * opens a different Session, which drops what the previous one cached and
 * refuses to hydrate its stored snapshot.
 */
export function useDevskiConnection(): DevskiConnection | null {
  const workspace = useWorkspaceState();
  const environment =
    workspace.environments.find((candidate) => candidate.connectionState === "connected") ??
    workspace.environments[0] ??
    null;
  const environmentId = environment?.environmentId ?? null;
  const connection = useSavedRemoteConnection(environmentId);
  const bearerToken = connection?.bearerToken;
  const httpBaseUrl = connection?.httpBaseUrl;

  const resolved = useMemo(
    () =>
      environmentId && bearerToken && httpBaseUrl
        ? { environmentId, httpBaseUrl, bearerToken }
        : null,
    [environmentId, bearerToken, httpBaseUrl],
  );

  // A null connection also covers the moment before the saved connection has
  // loaded, so this closes the Session rather than forgetting the record: what
  // was stored stays unreadable until its own credential opens it again.
  useEffect(() => {
    openDevskiCacheSession(
      resolved === null
        ? null
        : {
            environmentId: resolved.environmentId,
            fingerprint: devskiCacheFingerprint(resolved.httpBaseUrl, resolved.bearerToken),
          },
    );
  }, [resolved]);

  return resolved;
}
