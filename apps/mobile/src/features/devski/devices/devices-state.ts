/**
 * Pure interpretation of the Devski device management contract
 * (`/api/devski/v1/devices*`, PLO-421). The Gateway relays T3's persisted
 * session metadata, so this module only classifies responses and formats
 * non-secret display fields; it never invents device state.
 */

export type PairedDevice = {
  readonly sessionId: string;
  readonly name: string;
  readonly deviceType: string;
  readonly os: string | null;
  readonly createdAt: string | null;
  readonly lastSeenAt: string | null;
  readonly expiresAt: string | null;
  readonly connected: boolean;
  readonly current: boolean;
};

export type DevicesError = {
  readonly code: string;
  readonly message: string;
};

export type DevicesResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "pairing-required" }
  | { readonly kind: "error"; readonly error: DevicesError };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readDevice(value: unknown): PairedDevice | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const sessionId = readString(candidate.sessionId);
  const name = readString(candidate.name);
  if (!sessionId || !name) return null;
  return {
    sessionId,
    name,
    deviceType: readString(candidate.deviceType) ?? "unknown",
    os: readString(candidate.os),
    createdAt: readString(candidate.createdAt),
    lastSeenAt: readString(candidate.lastSeenAt),
    expiresAt: readString(candidate.expiresAt),
    connected: candidate.connected === true,
    current: candidate.current === true,
  };
}

export function readDevices(body: unknown): PairedDevice[] | null {
  if (!body || typeof body !== "object") return null;
  const devices = (body as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return null;
  const parsed: PairedDevice[] = [];
  for (const entry of devices) {
    const device = readDevice(entry);
    if (!device) return null;
    parsed.push(device);
  }
  return parsed;
}

export function readRevocation(body: unknown): { readonly revoked: boolean } | null {
  if (!body || typeof body !== "object") return null;
  const revoked = (body as { revoked?: unknown }).revoked;
  return typeof revoked === "boolean" ? { revoked } : null;
}

export function interpretDevicesResponse<T>(
  response:
    | { readonly kind: "response"; readonly status: number; readonly body: unknown }
    | { readonly kind: "network-error" },
  readValue: (body: unknown) => T | null,
): DevicesResult<T> {
  if (response.kind === "network-error") {
    return {
      kind: "error",
      error: { code: "devices_unavailable", message: "The device service is unreachable." },
    };
  }
  if (response.status === 401) return { kind: "pairing-required" };
  if (response.status >= 200 && response.status < 300) {
    const value = readValue(response.body);
    if (value !== null) return { kind: "ok", value };
    return {
      kind: "error",
      error: { code: "devices_unavailable", message: "The device service answered unexpectedly." },
    };
  }
  const body = response.body as { error?: unknown; message?: unknown } | null;
  if (body && typeof body === "object" && typeof body.error === "string") {
    return {
      kind: "error",
      error: {
        code: body.error,
        message: typeof body.message === "string" ? body.message : "The request failed.",
      },
    };
  }
  return {
    kind: "error",
    error: { code: "devices_unavailable", message: "The device service answered unexpectedly." },
  };
}

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString();
}

/** Plain metadata lines for one Paired Device row: text only. */
export function describeDeviceLines(device: PairedDevice): string[] {
  const lines: string[] = [];
  const kind = device.os ?? device.deviceType;
  lines.push(device.connected ? `${kind} · connected now` : kind);
  const paired = formatTimestamp(device.createdAt);
  if (paired) lines.push(`Paired ${paired}`);
  const lastSeen = formatTimestamp(device.lastSeenAt);
  lines.push(lastSeen ? `Last seen ${lastSeen}` : "Not seen yet");
  const expires = formatTimestamp(device.expiresAt);
  if (expires) lines.push(`Session expires ${expires}`);
  return lines;
}

/** The list orders the current device first, then most recently paired. */
export function sortDevices(devices: readonly PairedDevice[]): PairedDevice[] {
  return devices.toSorted((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "");
  });
}
