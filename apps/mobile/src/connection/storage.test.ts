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

import {
  CONNECTION_CATALOG_KEY,
  LEGACY_CONNECTIONS_KEY,
  make,
  PREVIOUS_CONNECTION_CATALOG_KEY,
} from "./catalog-store";
import { MobileSecureStorage } from "../persistence/mobile-secure-storage";

function makeStorage(
  initial: Readonly<Record<string, string>>,
  failures: { readonly write?: string; readonly delete?: string } = {},
) {
  const values = new Map(Object.entries(initial));
  const deleted: Array<string> = [];
  const storage = MobileSecureStorage.of({
    getItem: (key) => Effect.sync(() => values.get(key) ?? null),
    setItem: (key, value) =>
      Effect.sync(() => {
        if (failures.write === key) throw new Error("write failed");
        values.set(key, value);
      }),
    removeItem: (key) =>
      Effect.sync(() => {
        if (failures.delete === key) throw new Error("delete failed");
        deleted.push(key);
        values.delete(key);
      }),
  });
  return { deleted, storage, values };
}

describe("mobile connection catalog storage", () => {
  it.effect("moves the prior catalog key into device-only storage", () =>
    Effect.gen(function* () {
      const previousCatalog = JSON.stringify({
        schemaVersion: 1,
        targets: [],
        profiles: [],
        credentials: [],
        remoteDpopTokens: [],
      });
      const memory = makeStorage({ [PREVIOUS_CONNECTION_CATALOG_KEY]: previousCatalog });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toEqual([]);
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
      expect(memory.values.has(PREVIOUS_CONNECTION_CATALOG_KEY)).toBe(false);
      expect(memory.deleted).toEqual([PREVIOUS_CONNECTION_CATALOG_KEY]);
    }),
  );

  it.effect("keeps the prior catalog when the device-only write fails", () =>
    Effect.gen(function* () {
      const previousCatalog = JSON.stringify({
        schemaVersion: 1,
        targets: [],
        profiles: [],
        credentials: [],
        remoteDpopTokens: [],
      });
      const memory = makeStorage(
        { [PREVIOUS_CONNECTION_CATALOG_KEY]: previousCatalog },
        { write: CONNECTION_CATALOG_KEY },
      );
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      expect(yield* Effect.exit(catalog.read)).toMatchObject({ _tag: "Failure" });
      expect(memory.values.get(PREVIOUS_CONNECTION_CATALOG_KEY)).toBe(previousCatalog);
      expect(memory.deleted).toEqual([]);
    }),
  );

  it.effect("retries prior-key cleanup after the device-only write succeeds", () =>
    Effect.gen(function* () {
      const previousCatalog = JSON.stringify({
        schemaVersion: 1,
        targets: [],
        profiles: [],
        credentials: [],
        remoteDpopTokens: [],
      });
      const memory = makeStorage(
        { [PREVIOUS_CONNECTION_CATALOG_KEY]: previousCatalog },
        { delete: PREVIOUS_CONNECTION_CATALOG_KEY },
      );
      const first = yield* make().pipe(Effect.provideService(MobileSecureStorage, memory.storage));

      expect(yield* Effect.exit(first.read)).toMatchObject({ _tag: "Failure" });
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
      expect(memory.values.has(PREVIOUS_CONNECTION_CATALOG_KEY)).toBe(true);
    }),
  );

  it.effect("recovers from a corrupt current catalog", () =>
    Effect.gen(function* () {
      const memory = makeStorage({
        [CONNECTION_CATALOG_KEY]: "{not-json",
      });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toEqual([]);
      expect(memory.deleted).toEqual([CONNECTION_CATALOG_KEY]);
    }),
  );

  it.effect("replaces and removes a corrupt legacy catalog", () =>
    Effect.gen(function* () {
      const memory = makeStorage({
        [LEGACY_CONNECTIONS_KEY]: JSON.stringify({ connections: [{ invalid: true }] }),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toEqual([]);
      expect(memory.deleted).toEqual([LEGACY_CONNECTIONS_KEY]);
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
    }),
  );

  it.effect("falls back to valid legacy data when the current catalog is corrupt", () =>
    Effect.gen(function* () {
      const memory = makeStorage({
        [CONNECTION_CATALOG_KEY]: "{not-json",
        [LEGACY_CONNECTIONS_KEY]: JSON.stringify({
          connections: [
            {
              environmentId: "legacy-environment",
              environmentLabel: "Legacy",
              pairingUrl: "https://legacy.example.test/pair",
              displayUrl: "https://legacy.example.test",
              httpBaseUrl: "https://legacy.example.test",
              wsBaseUrl: "wss://legacy.example.test",
              bearerToken: "legacy-token",
              authenticationMethod: "bearer",
            },
          ],
        }),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(MobileSecureStorage, memory.storage),
      );

      expect((yield* catalog.read).targets).toHaveLength(1);
      expect(memory.deleted).toEqual([CONNECTION_CATALOG_KEY, LEGACY_CONNECTIONS_KEY]);

      yield* catalog.update((document) => document);
      expect(memory.values.has(CONNECTION_CATALOG_KEY)).toBe(true);
      expect(memory.values.has(LEGACY_CONNECTIONS_KEY)).toBe(false);
    }),
  );
});
