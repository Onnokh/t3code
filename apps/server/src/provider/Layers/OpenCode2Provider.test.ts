import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import { describe } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http";

import { OpenCode2Settings } from "@t3tools/contracts";
import { OPENCODE2_PINNED_VERSION } from "../opencode2Runtime.ts";
import { checkOpenCode2ProviderStatus } from "./OpenCode2Provider.ts";

const decodeSettings = Schema.decodeSync(OpenCode2Settings);

const SERVER_URL = "http://devski-opencode:4096";
const LOCATION_DIRECTORY_PARAM = "location[directory]";

/**
 * A server that answers the version handshake and nothing else. The probe
 * reaches the directory-scoped endpoints right after `health.get`, so the
 * directory is already on the wire by the time the rest fails — which is all
 * these tests read.
 */
function stubOpenCode2Server(recorded: Array<HttpClientRequest.HttpClientRequest>) {
  return HttpClient.make((request) =>
    Effect.sync(() => {
      recorded.push(request);
      const body = request.url.endsWith("/api/health")
        ? Response.json({ healthy: true, version: OPENCODE2_PINNED_VERSION, pid: 1 })
        : new Response(null, { status: 500 });
      return HttpClientResponse.fromWeb(request, body);
    }),
  );
}

function probeDirectories(
  recorded: ReadonlyArray<HttpClientRequest.HttpClientRequest>,
): ReadonlyArray<string> {
  return recorded.flatMap((request) =>
    request.urlParams.params.flatMap(([key, value]) =>
      key === LOCATION_DIRECTORY_PARAM ? [value] : [],
    ),
  );
}

describe("checkOpenCode2ProviderStatus", () => {
  it.effect("probes the configured Code Workspace Root rather than this server's cwd", () =>
    Effect.gen(function* () {
      const recorded: Array<HttpClientRequest.HttpClientRequest> = [];
      const settings = decodeSettings({
        serverUrl: SERVER_URL,
        workspaceRoot: "/workspaces/code",
      });

      // The deployed T3 container runs from /srv/t3code, a path the external
      // OpenCode server cannot resolve: it answers 500 and the provider goes
      // to `error` even though every setting is correct.
      yield* checkOpenCode2ProviderStatus(settings, "/srv/t3code").pipe(
        Effect.provideService(HttpClient.HttpClient, stubOpenCode2Server(recorded)),
      );

      const directories = probeDirectories(recorded);
      NodeAssert.ok(directories.length > 0);
      for (const directory of directories) {
        NodeAssert.equal(directory, "/workspaces/code");
      }
    }),
  );

  it.effect("falls back to the given directory when no workspace root is configured", () =>
    Effect.gen(function* () {
      const recorded: Array<HttpClientRequest.HttpClientRequest> = [];
      const settings = decodeSettings({ serverUrl: SERVER_URL });

      yield* checkOpenCode2ProviderStatus(settings, "/home/dev/project").pipe(
        Effect.provideService(HttpClient.HttpClient, stubOpenCode2Server(recorded)),
      );

      const directories = probeDirectories(recorded);
      NodeAssert.ok(directories.length > 0);
      for (const directory of directories) {
        NodeAssert.equal(directory, "/home/dev/project");
      }
    }),
  );
});
