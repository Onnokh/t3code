import * as NodeModule from "node:module";

import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const plugin = require("./withoutIosPersonalTeamCapabilities.cjs") as {
  stripPersonalTeamEntitlements: (entitlements: Record<string, unknown>) => Record<string, unknown>;
};

describe("withoutIosPersonalTeamCapabilities", () => {
  it("removes every entitlement unavailable to a Personal Team", () => {
    const entitlements = {
      "aps-environment": "development",
      "com.apple.developer.applesignin": ["Default"],
      "com.apple.security.application-groups": ["group.dev.onkie.devski.dev"],
      "com.apple.developer.associated-domains": ["applinks:devski.onkie.dev"],
      "com.apple.developer.networking.wifi-info": true,
    };

    expect(plugin.stripPersonalTeamEntitlements(entitlements)).toEqual({
      "com.apple.developer.networking.wifi-info": true,
    });
  });
});
