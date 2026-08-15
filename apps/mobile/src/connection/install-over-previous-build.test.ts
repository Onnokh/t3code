import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import { CONNECTION_CATALOG_KEY, make, PREVIOUS_CONNECTION_CATALOG_KEY } from "./catalog-store";
import { MobileSecureStorage } from "../persistence/mobile-secure-storage";

function makeStorage(initial: Readonly<Record<string, string>>) {
  const values = new Map(Object.entries(initial));
  const deleted: Array<string> = [];
  const storage = MobileSecureStorage.of({
    getItem: (key) => Effect.sync(() => values.get(key) ?? null),
    setItem: (key, value) => Effect.sync(() => void values.set(key, value)),
    removeItem: (key) =>
      Effect.sync(() => {
        deleted.push(key);
        values.delete(key);
      }),
  });
  return { deleted, storage, values };
}

/**
 * Install-over-previous-build state contract (PLO-422).
 *
 * These fixtures are the VERBATIM SecureStore payloads a previously shipped
 * Devski build wrote — do not regenerate them with the current encoder. A
 * TestFlight build installed over the previous build must read this exact
 * bytes-on-device format, keep the paired Device Session, and never wipe or
 * re-pair. If the catalog schema changes, add an explicit migration and a new
 * frozen fixture for the new previous format; do not edit these strings to
 * make the test pass.
 */
const PREVIOUS_BUILD_CATALOG = JSON.stringify({
  schemaVersion: 1,
  targets: [
    {
      _tag: "BearerConnectionTarget",
      environmentId: "devski-environment",
      label: "Digital Home",
      connectionId: "bearer:devski-environment",
    },
  ],
  profiles: [
    {
      _tag: "BearerConnectionProfile",
      connectionId: "bearer:devski-environment",
      environmentId: "devski-environment",
      label: "Digital Home",
      httpBaseUrl: "https://devski.onkie.dev",
      wsBaseUrl: "wss://devski.onkie.dev",
    },
  ],
  credentials: [
    {
      connectionId: "bearer:devski-environment",
      credential: {
        _tag: "BearerConnectionCredential",
        token: "device-session-bearer-from-previous-build",
      },
    },
  ],
  remoteDpopTokens: [],
});

describe("installing a new build over the previous Devski build", () => {
  it.effect("reads the previous build's catalog and keeps the Device Session", () =>
    Effect.gen(function* () {
      const memory = makeStorage({ [CONNECTION_CATALOG_KEY]: PREVIOUS_BUILD_CATALOG });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      const document = yield* catalog.read;
      expect(document.targets).toHaveLength(1);
      expect(document.targets[0]).toMatchObject({
        _tag: "BearerConnectionTarget",
        environmentId: "devski-environment",
        connectionId: "bearer:devski-environment",
      });
      expect(document.profiles[0]).toMatchObject({
        httpBaseUrl: "https://devski.onkie.dev",
        wsBaseUrl: "wss://devski.onkie.dev",
      });
      expect(document.credentials[0]).toMatchObject({
        connectionId: "bearer:devski-environment",
        credential: { token: "device-session-bearer-from-previous-build" },
      });

      // The upgrade path must not discard or rewrite valid persisted state.
      expect(memory.deleted).toEqual([]);
      expect(memory.values.get(CONNECTION_CATALOG_KEY)).toBe(PREVIOUS_BUILD_CATALOG);
    }),
  );

  it.effect("survives a write cycle without losing the paired connection", () =>
    Effect.gen(function* () {
      const memory = makeStorage({ [CONNECTION_CATALOG_KEY]: PREVIOUS_BUILD_CATALOG });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      yield* catalog.update((document) => document);

      const persisted = memory.values.get(CONNECTION_CATALOG_KEY);
      expect(persisted).toBeDefined();
      const reencoded = JSON.parse(persisted as string) as {
        targets: ReadonlyArray<unknown>;
        credentials: ReadonlyArray<{ credential: { token: string } }>;
      };
      expect(reencoded.targets).toHaveLength(1);
      expect(reencoded.credentials[0]?.credential.token).toBe(
        "device-session-bearer-from-previous-build",
      );
    }),
  );

  it.effect("migrates a populated device-shared catalog into device-only storage intact", () =>
    Effect.gen(function* () {
      // The build before the device-only storage move kept the same document
      // under the v1 key. Installing over that build must move the data, not
      // merely the empty document shape.
      const memory = makeStorage({ [PREVIOUS_CONNECTION_CATALOG_KEY]: PREVIOUS_BUILD_CATALOG });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      const document = yield* catalog.read;
      expect(document.targets).toHaveLength(1);
      expect(document.credentials[0]).toMatchObject({
        credential: { token: "device-session-bearer-from-previous-build" },
      });
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
      expect(memory.values.has(PREVIOUS_CONNECTION_CATALOG_KEY)).toBe(false);
    }),
  );
});
