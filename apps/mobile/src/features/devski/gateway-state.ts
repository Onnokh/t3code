/**
 * Pure interpretation of the Devski Gateway capabilities contract
 * (`GET /api/devski/v1/capabilities`). The Gateway validates the caller's
 * Device Session against T3 and reports honest per-service health, so this
 * module only classifies responses; it never invents availability.
 */

export type DevskiServiceHealth = {
  readonly status: "available" | "degraded" | "unavailable";
  readonly reason?: string;
};

export type DevskiCapabilities = {
  readonly session: { readonly expiresAt: string | null };
  readonly capabilities: {
    readonly code: DevskiServiceHealth;
    readonly seo: DevskiServiceHealth;
    readonly automations: DevskiServiceHealth;
    readonly notifications: DevskiServiceHealth;
  };
};

export type DevskiGatewayState =
  | { readonly kind: "unpaired"; readonly message: string }
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "ready"; readonly capabilities: DevskiCapabilities; readonly message: string }
  | { readonly kind: "pairing-required"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

export const UNPAIRED_STATE: DevskiGatewayState = {
  kind: "unpaired",
  message: "Pair this device in Code to use Devski services.",
};

export const LOADING_STATE: DevskiGatewayState = {
  kind: "loading",
  message: "Checking Devski services…",
};

export const GATEWAY_UNAVAILABLE_STATE: DevskiGatewayState = {
  kind: "unavailable",
  message:
    "No Devski Gateway is answering at this environment. Code keeps working; SEO and Automations wait for the Gateway.",
};

const PAIRING_REQUIRED_STATE: DevskiGatewayState = {
  kind: "pairing-required",
  message: "This Device Session expired or was revoked. Pair this device again.",
};

const FORBIDDEN_STATE: DevskiGatewayState = {
  kind: "unavailable",
  message: "This Device Session cannot read Devski services.",
};

function toServiceHealth(value: unknown): DevskiServiceHealth | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { status?: unknown; reason?: unknown };
  if (
    candidate.status !== "available" &&
    candidate.status !== "degraded" &&
    candidate.status !== "unavailable"
  ) {
    return null;
  }
  return {
    status: candidate.status,
    ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
  };
}

function toCapabilities(body: unknown): DevskiCapabilities | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as {
    session?: { expiresAt?: unknown };
    capabilities?: Record<string, unknown>;
  };
  const services = candidate.capabilities;
  if (!services || typeof services !== "object") return null;
  const code = toServiceHealth(services.code);
  const seo = toServiceHealth(services.seo);
  const automations = toServiceHealth(services.automations);
  const notifications = toServiceHealth(services.notifications);
  if (!code || !seo || !automations || !notifications) return null;
  return {
    session: {
      expiresAt:
        typeof candidate.session?.expiresAt === "string" ? candidate.session.expiresAt : null,
    },
    capabilities: { code, seo, automations, notifications },
  };
}

export function interpretCapabilitiesResponse(
  response:
    | { readonly kind: "response"; readonly status: number; readonly body: unknown }
    | { readonly kind: "network-error" },
): DevskiGatewayState {
  if (response.kind === "network-error") return GATEWAY_UNAVAILABLE_STATE;
  if (response.status === 401) return PAIRING_REQUIRED_STATE;
  if (response.status === 403) return FORBIDDEN_STATE;
  if (response.status !== 200) return GATEWAY_UNAVAILABLE_STATE;
  const capabilities = toCapabilities(response.body);
  if (!capabilities) return GATEWAY_UNAVAILABLE_STATE;
  return {
    kind: "ready",
    capabilities,
    message: "This Device Session is shared by Code, SEO, and Automations.",
  };
}

const REASON_DESCRIPTIONS: Record<string, string> = {
  seo_not_configured: "not configured on the server",
  automations_not_configured: "not configured on the server",
  notifications_not_configured: "not configured on the server",
  seo_unreachable: "service unreachable",
  automations_unreachable: "service unreachable",
  seo_unhealthy: "service responding but unhealthy",
  automations_unhealthy: "service responding but unhealthy",
};

export function describeServiceHealth(health: DevskiServiceHealth): string {
  const label =
    health.status === "available"
      ? "Available"
      : health.status === "degraded"
        ? "Degraded"
        : "Unavailable";
  if (!health.reason) return label;
  const detail = REASON_DESCRIPTIONS[health.reason] ?? health.reason.replace(/_/g, " ");
  return `${label} (${detail})`;
}
