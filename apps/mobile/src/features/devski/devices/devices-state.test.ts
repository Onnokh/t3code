import { describe, expect, it } from "vite-plus/test";

import {
  describeDeviceLines,
  interpretDevicesResponse,
  readDevices,
  readRevocation,
  sortDevices,
  type PairedDevice,
} from "./devices-state";

const DEVICE_A: PairedDevice = {
  sessionId: "session-a",
  name: "Onno's iPhone",
  deviceType: "mobile",
  os: "iOS 26",
  createdAt: "2026-08-01T10:00:00.000Z",
  lastSeenAt: "2026-08-15T09:00:00.000Z",
  expiresAt: "2026-08-31T10:00:00.000Z",
  connected: true,
  current: true,
};

const DEVICE_B: PairedDevice = {
  sessionId: "session-b",
  name: "iOS 26 device",
  deviceType: "mobile",
  os: "iOS 26",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastSeenAt: null,
  expiresAt: "2026-09-09T10:00:00.000Z",
  connected: false,
  current: false,
};

describe("readDevices", () => {
  it("parses the Gateway device list", () => {
    expect(readDevices({ devices: [DEVICE_A, DEVICE_B] })).toEqual([DEVICE_A, DEVICE_B]);
  });

  it("rejects lists containing malformed entries", () => {
    expect(readDevices({ devices: [DEVICE_A, { name: "no session id" }] })).toBeNull();
    expect(readDevices({})).toBeNull();
    expect(readDevices(null)).toBeNull();
  });
});

describe("interpretDevicesResponse", () => {
  it("classifies 401 as pairing-required", () => {
    const result = interpretDevicesResponse(
      { kind: "response", status: 401, body: { error: "device_session_invalid" } },
      readDevices,
    );
    expect(result.kind).toBe("pairing-required");
  });

  it("surfaces the Gateway error code for refused operations", () => {
    const result = interpretDevicesResponse(
      {
        kind: "response",
        status: 403,
        body: { error: "current_session_revoke_not_allowed", message: "Use sign out instead." },
      },
      readRevocation,
    );
    expect(result).toEqual({
      kind: "error",
      error: { code: "current_session_revoke_not_allowed", message: "Use sign out instead." },
    });
  });

  it("classifies a network failure as unavailable", () => {
    const result = interpretDevicesResponse({ kind: "network-error" }, readDevices);
    expect(result).toEqual({
      kind: "error",
      error: { code: "devices_unavailable", message: "The device service is unreachable." },
    });
  });

  it("reads a successful revocation", () => {
    const result = interpretDevicesResponse(
      { kind: "response", status: 200, body: { revoked: true } },
      readRevocation,
    );
    expect(result).toEqual({ kind: "ok", value: { revoked: true } });
  });
});

describe("device display", () => {
  it("orders the current device first, then most recently paired", () => {
    const third: PairedDevice = {
      ...DEVICE_B,
      sessionId: "session-c",
      createdAt: "2026-08-12T10:00:00.000Z",
    };
    expect(sortDevices([DEVICE_B, third, DEVICE_A]).map((device) => device.sessionId)).toEqual([
      "session-a",
      "session-c",
      "session-b",
    ]);
  });

  it("describes paired, last-seen, and expiry lines from session metadata", () => {
    const lines = describeDeviceLines(DEVICE_A);
    expect(lines[0]).toContain("connected now");
    expect(lines.some((line) => line.startsWith("Paired "))).toBe(true);
    expect(lines.some((line) => line.startsWith("Last seen "))).toBe(true);
    expect(lines.some((line) => line.startsWith("Session expires "))).toBe(true);
  });

  it("marks devices that never connected", () => {
    const lines = describeDeviceLines(DEVICE_B);
    expect(lines).toContain("Not seen yet");
    expect(lines[0]).toBe("iOS 26");
  });
});
