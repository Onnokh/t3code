import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@expo/ui/swift-ui", () => ({
  HStack: "HStack",
  Image: "Image",
  Spacer: "Spacer",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  font: (value: unknown) => value,
  foregroundStyle: (value: unknown) => value,
  frame: (value: unknown) => value,
  layoutPriority: (value: unknown) => value,
  lineLimit: (value: unknown) => value,
  padding: (value: unknown) => value,
  resizable: (value: unknown) => value,
  widgetURL: (value: unknown) => ({ widgetURL: value }),
}));
vi.mock("expo-widgets", () => ({
  createLiveActivity: vi.fn(() => ({
    getInstances: vi.fn(() => []),
    start: vi.fn(),
  })),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-notifications", () => ({
  getDevicePushTokenAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));
vi.mock("../../../lib/runtime", () => ({ runtime: { runPromiseExit: vi.fn() } }));
vi.mock("../../../persistence/imperative", () => ({
  loadOrCreateAgentAwarenessDeviceId: vi.fn(),
  loadPreferences: vi.fn(),
  savePreferencesPatch: vi.fn(),
}));
vi.mock("../../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnection: vi.fn(),
}));
vi.mock("../../../state/workspace", () => ({ useWorkspaceState: vi.fn() }));

import {
  offerAutomationNotifications,
  registerAutomationNotificationsWithGateway,
  type AutomationNotificationDeps,
} from "./automationNotifications";

function makeDeps(overrides: Partial<AutomationNotificationDeps> = {}): AutomationNotificationDeps {
  return {
    wasOffered: async () => false,
    markOffered: async () => undefined,
    requestPermission: async () => "granted",
    readPushToken: async () => "apns-token-1",
    register: async () => true,
    deviceId: async () => "device-1",
    apsEnvironment: "production",
    ...overrides,
  };
}

describe("offerAutomationNotifications", () => {
  it("offers once: permission, token, then a Device Session bound registration", async () => {
    const registered: Array<Record<string, unknown>> = [];
    const markOffered = vi.fn(async () => undefined);
    const outcome = await offerAutomationNotifications(
      makeDeps({
        markOffered,
        register: async (input) => {
          registered.push(input);
          return true;
        },
      }),
    );
    expect(outcome).toBe("registered");
    expect(markOffered).toHaveBeenCalledTimes(1);
    expect(registered).toEqual([
      { deviceId: "device-1", pushToken: "apns-token-1", apsEnvironment: "production" },
    ]);
  });

  it("never prompts again after the one contextual offer", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    const outcome = await offerAutomationNotifications(
      makeDeps({ wasOffered: async () => true, requestPermission }),
    );
    expect(outcome).toBe("already_offered");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("records the offer before prompting so a crash cannot re-prompt", async () => {
    const order: string[] = [];
    await offerAutomationNotifications(
      makeDeps({
        markOffered: async () => {
          order.push("marked");
        },
        requestPermission: async () => {
          order.push("prompted");
          return "granted";
        },
      }),
    );
    expect(order).toEqual(["marked", "prompted"]);
  });

  it("keeps Automations fully usable when permission is denied", async () => {
    const register = vi.fn(async () => true);
    const outcome = await offerAutomationNotifications(
      makeDeps({ requestPermission: async () => "denied", register }),
    );
    expect(outcome).toBe("permission_denied");
    expect(register).not.toHaveBeenCalled();
  });

  it("treats a missing push token as unavailable rather than failing", async () => {
    const outcome = await offerAutomationNotifications(
      makeDeps({ readPushToken: async () => null }),
    );
    expect(outcome).toBe("unavailable");
  });
});

describe("registerAutomationNotificationsWithGateway", () => {
  it("PUTs the registration with the Device Session bearer only", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ registration: { deviceId: "device-1" } }), {
        status: 200,
      });
    }) as typeof fetch;

    const ok = await registerAutomationNotificationsWithGateway({
      httpBaseUrl: "https://devski.onkie.dev/",
      bearerToken: "device-session-bearer",
      deviceId: "device-1",
      pushToken: "apns-token-1",
      apsEnvironment: "sandbox",
      fetchImpl,
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://devski.onkie.dev/api/devski/v1/notifications/registration");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer device-session-bearer");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      deviceId: "device-1",
      pushToken: "apns-token-1",
      apsEnvironment: "sandbox",
    });
  });

  it("reports an unreachable Gateway as a soft failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const ok = await registerAutomationNotificationsWithGateway({
      httpBaseUrl: "https://devski.onkie.dev",
      bearerToken: "bearer",
      deviceId: "device-1",
      pushToken: "apns-token-1",
      apsEnvironment: "production",
      fetchImpl,
    });
    expect(ok).toBe(false);
  });
});
