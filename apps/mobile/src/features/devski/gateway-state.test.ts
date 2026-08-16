import { describe, expect, it } from "vite-plus/test";

import {
  describeServiceHealth,
  GATEWAY_UNAVAILABLE_STATE,
  interpretCapabilitiesResponse,
} from "./gateway-state";

const readyBody = {
  session: { expiresAt: "2099-01-01T00:00:00.000Z" },
  capabilities: {
    code: { status: "available" },
    seo: { status: "degraded", reason: "seo_unreachable" },
    automations: { status: "unavailable", reason: "automations_not_configured" },
    notifications: { status: "unavailable", reason: "notifications_not_configured" },
  },
} as const;

describe("interpretCapabilitiesResponse", () => {
  it("accepts an honest capabilities payload", () => {
    const state = interpretCapabilitiesResponse({ kind: "response", status: 200, body: readyBody });
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.capabilities.session.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(state.capabilities.capabilities.seo).toEqual({
      status: "degraded",
      reason: "seo_unreachable",
    });
  });

  it("fails closed on an expired or revoked Device Session", () => {
    const state = interpretCapabilitiesResponse({ kind: "response", status: 401, body: null });
    expect(state.kind).toBe("pairing-required");
  });

  it("keeps the session on a capability rejection", () => {
    const state = interpretCapabilitiesResponse({ kind: "response", status: 403, body: null });
    expect(state.kind).toBe("unavailable");
  });

  it("treats a malformed payload as an unavailable Gateway", () => {
    const state = interpretCapabilitiesResponse({
      kind: "response",
      status: 200,
      body: { capabilities: { code: { status: "great" } } },
    });
    expect(state).toBe(GATEWAY_UNAVAILABLE_STATE);
  });

  it("treats a network failure as an unavailable Gateway", () => {
    expect(interpretCapabilitiesResponse({ kind: "network-error" })).toBe(
      GATEWAY_UNAVAILABLE_STATE,
    );
  });
});

describe("describeServiceHealth", () => {
  it("renders plain honest health text", () => {
    expect(describeServiceHealth({ status: "available" })).toBe("Available");
    expect(describeServiceHealth({ status: "degraded", reason: "seo_unreachable" })).toBe(
      "Degraded (service unreachable)",
    );
    expect(
      describeServiceHealth({ status: "unavailable", reason: "automations_not_configured" }),
    ).toBe("Unavailable (not configured on the server)");
    expect(describeServiceHealth({ status: "unavailable", reason: "future_reason" })).toBe(
      "Unavailable (future reason)",
    );
  });
});
