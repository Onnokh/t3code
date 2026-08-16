import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SecureStore from "expo-secure-store";
import { vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(() => Promise.resolve()),
}));

import { make } from "./mobile-secure-storage";

describe("MobileSecureStorage", () => {
  it.effect("writes secrets with device-only, unlocked Keychain accessibility", () =>
    Effect.gen(function* () {
      yield* make.setItem("connection-catalog", "secret");

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("connection-catalog", "secret", {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }),
  );
});
