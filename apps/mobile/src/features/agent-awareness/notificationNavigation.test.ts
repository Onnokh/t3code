import type { NotificationResponse } from "expo-notifications";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { consumeLastAgentNotificationResponse } from "./notificationResponseConsumer";

import {
  extractAgentNotificationDeepLink,
  normalizeExpoDevelopmentClientDeepLink,
  routeAgentNotificationDeepLink,
  routeAgentNotificationResponseOnce,
} from "./notificationPayload";

function responseWithData(data: Record<string, unknown>, identifier = "notification-1") {
  return {
    notification: {
      request: {
        identifier,
        content: {
          data,
        },
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumeLastAgentNotificationResponse", () => {
  it("reports which initial-response operation failed", async () => {
    const cause = new Error("notification lookup unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.reject(cause),
      clearLastResponse: () => Promise.resolve(),
      handleResponse: vi.fn(),
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "NotificationNavigationError",
        operation: "read",
      }),
    );
  });

  it("routes a response before reporting a clear failure", async () => {
    const cause = new Error("notification clear unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = responseWithData({}, "notification-clear") as NotificationResponse;
    const handleResponse = vi.fn();

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.resolve(response),
      clearLastResponse: () => Promise.reject(cause),
      handleResponse,
    });

    expect(handleResponse).toHaveBeenCalledWith(response);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "NotificationNavigationError",
        operation: "clear",
        notificationId: "notification-clear",
      }),
    );
  });

  it("reports routing failures before clearing the response", async () => {
    const cause = new Error("notification routing unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = responseWithData({}, "notification-route") as NotificationResponse;
    const clearLastResponse = vi.fn(() => Promise.resolve());

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.resolve(response),
      clearLastResponse,
      handleResponse: () => {
        throw cause;
      },
    });

    expect(clearLastResponse).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "NotificationNavigationError",
        operation: "route",
        notificationId: "notification-route",
      }),
    );
  });
});

describe("extractAgentNotificationDeepLink", () => {
  it("uses explicit deep links from APNs payload data", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          deepLink: "/threads/env/thread",
          environmentId: "ignored",
          threadId: "ignored",
        }),
      ),
    ).toBe("/threads/env/thread");
  });

  it("normalizes explicit thread deep links from APNs payload data", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          deepLink: "/threads/env%201/thread%2F2",
        }),
      ),
    ).toBe("/threads/env%201/thread%2F2");
  });

  it("falls back to the thread route from environment and thread ids", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          environmentId: "env 1",
          threadId: "thread/2",
        }),
      ),
    ).toBe("/threads/env%201/thread%2F2");
  });

  it("falls back to ids when explicit deep link is not an agent thread route", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          deepLink: "/",
          environmentId: "env",
          threadId: "thread",
        }),
      ),
    ).toBe("/threads/env/thread");
  });

  it("accepts the Automation Run detail deep link (PLO-420)", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({ deepLink: "/automations/runs/9f2c1a34-1b2c-4d5e-8f90-a1b2c3d4e5f6" }),
      ),
    ).toBe("/automations/runs/9f2c1a34-1b2c-4d5e-8f90-a1b2c3d4e5f6");
  });

  it("accepts the fixed Expo development-client route with an HTTPS packager", () => {
    const deepLink =
      "devski.dev://expo-development-client/?url=https%3A%2F%2Fmetro.trycloudflare.com%2F";
    expect(normalizeExpoDevelopmentClientDeepLink(deepLink)).toBe(deepLink);
    expect(extractAgentNotificationDeepLink(responseWithData({ deepLink }))).toBe(deepLink);
  });

  it("rejects development-client links with unsafe outer or nested URLs", () => {
    for (const deepLink of [
      "devski://expo-development-client/?url=https%3A%2F%2Fmetro.trycloudflare.com%2F",
      "devski.dev://other/?url=https%3A%2F%2Fmetro.trycloudflare.com%2F",
      "devski.dev://expo-development-client/?url=http%3A%2F%2F192.168.1.187%3A8083",
      "devski.dev://expo-development-client/?url=javascript%3Aalert(1)",
      "devski.dev://expo-development-client/?url=https%3A%2F%2Fmetro.trycloudflare.com%2F%23x",
      "devski.dev://expo-development-client/?url=https%3A%2F%2Fmetro.trycloudflare.com%2F&x=1",
    ]) {
      expect(normalizeExpoDevelopmentClientDeepLink(deepLink)).toBeNull();
      expect(extractAgentNotificationDeepLink(responseWithData({ deepLink }))).toBeNull();
    }
  });

  it("rejects Automation deep links outside the Run detail allowlist", () => {
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "/automations/runs" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "/automations/jobs/job-1" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({ deepLink: "/automations/runs/run-1/extra" }),
      ),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({ deepLink: "/automations/runs/run-1?x=1" }),
      ),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({ deepLink: "/automations/runs/run%2F../escape" }),
      ),
    ).toBeNull();
  });

  it("ignores malformed or external links", () => {
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "https://example.com" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "/settings" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "//example.com" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "/threads/env/thread?x=1" })),
    ).toBeNull();
    expect(extractAgentNotificationDeepLink({})).toBeNull();
  });
});

describe("routeAgentNotificationResponseOnce", () => {
  it("does not navigate twice when the initial and listener responses refer to one notification", () => {
    const handledResponseIds = new Set<string>();
    const navigations: Array<string> = [];
    const response = responseWithData({
      environmentId: "env",
      threadId: "thread",
    });

    routeAgentNotificationResponseOnce({
      handledResponseIds,
      response,
      navigate: (deepLink) => navigations.push(deepLink),
    });
    routeAgentNotificationResponseOnce({
      handledResponseIds,
      response,
      navigate: (deepLink) => navigations.push(deepLink),
    });

    expect(navigations).toEqual(["/threads/env/thread"]);
  });
});

describe("routeAgentNotificationDeepLink", () => {
  it("opens an Expo development-client destination with native Linking", async () => {
    const openURL = vi.fn(() => Promise.resolve());
    const navigate = vi.fn();
    const deepLink =
      "devski.dev://expo-development-client/?url=https%3A%2F%2Fmetro.trycloudflare.com%2F";

    routeAgentNotificationDeepLink({ deepLink, navigate, openURL });
    await Promise.resolve();

    expect(openURL).toHaveBeenCalledWith(deepLink);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps internal destinations inside React Navigation", () => {
    const openURL = vi.fn(() => Promise.resolve());
    const navigate = vi.fn();

    routeAgentNotificationDeepLink({
      deepLink: "/threads/environment/thread",
      navigate,
      openURL,
    });

    expect(navigate).toHaveBeenCalledWith("/threads/environment/thread");
    expect(openURL).not.toHaveBeenCalled();
  });
});
