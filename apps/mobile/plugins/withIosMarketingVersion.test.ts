import * as NodeModule from "node:module";

import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const plugin = require("./withIosMarketingVersion.cjs") as ((config: unknown) => unknown) & {
  stampMarketingVersion: (project: unknown, marketingVersion: string) => ReadonlyArray<string>;
};

function buildSettings(productName: string, marketingVersion: string) {
  return {
    isa: "XCBuildConfiguration",
    buildSettings: { PRODUCT_NAME: productName, MARKETING_VERSION: marketingVersion },
  };
}

/**
 * The extension targets reproduce the regression: their creating plugins leave
 * MARKETING_VERSION at Xcode's 1.0 default while the app carries 0.1.0, and the
 * framework target proves only signable targets are stamped.
 */
function fakeXcodeProject() {
  const configurations = {
    APP_DEBUG: buildSettings('"Devski"', "0.1.0"),
    APP_RELEASE: buildSettings('"Devski"', "0.1.0"),
    SHARE_DEBUG: buildSettings('"$(TARGET_NAME)"', "1.0"),
    WIDGET_DEBUG: buildSettings('"$(TARGET_NAME)"', "1.0"),
    FRAMEWORK_DEBUG: buildSettings('"$(TARGET_NAME)"', "1.0"),
  };

  return {
    configurations,
    project: {
      pbxNativeTargetSection: () => ({
        APP: {
          name: "Devski",
          productType: '"com.apple.product-type.application"',
          buildConfigurationList: "LIST_APP",
        },
        APP_comment: "Devski",
        SHARE: {
          name: '"expo-sharing-extension"',
          productType: '"com.apple.product-type.app-extension"',
          buildConfigurationList: "LIST_SHARE",
        },
        WIDGET: {
          name: "ExpoWidgetsTarget",
          productType: '"com.apple.product-type.app-extension"',
          buildConfigurationList: "LIST_WIDGET",
        },
        FRAMEWORK: {
          name: "Pods",
          productType: '"com.apple.product-type.framework"',
          buildConfigurationList: "LIST_FRAMEWORK",
        },
      }),
      pbxXCConfigurationList: () => ({
        LIST_APP: { buildConfigurations: [{ value: "APP_DEBUG" }, { value: "APP_RELEASE" }] },
        LIST_SHARE: { buildConfigurations: [{ value: "SHARE_DEBUG" }] },
        LIST_WIDGET: { buildConfigurations: [{ value: "WIDGET_DEBUG" }] },
        LIST_FRAMEWORK: { buildConfigurations: [{ value: "FRAMEWORK_DEBUG" }] },
      }),
      pbxXCBuildConfigurationSection: () => configurations,
    },
  };
}

describe("withIosMarketingVersion", () => {
  it("gives every signable target the app's marketing version", () => {
    const { configurations, project } = fakeXcodeProject();

    expect(plugin.stampMarketingVersion(project, "0.1.0")).toEqual([
      "Devski",
      "expo-sharing-extension",
      "ExpoWidgetsTarget",
    ]);

    // The extensions are what App Store Connect rejects when they disagree
    // with the app, so they are the point of the plugin.
    expect(configurations.SHARE_DEBUG.buildSettings.MARKETING_VERSION).toBe("0.1.0");
    expect(configurations.WIDGET_DEBUG.buildSettings.MARKETING_VERSION).toBe("0.1.0");
    expect(configurations.APP_DEBUG.buildSettings.MARKETING_VERSION).toBe("0.1.0");
    expect(configurations.APP_RELEASE.buildSettings.MARKETING_VERSION).toBe("0.1.0");
  });

  it("leaves targets that Xcode never signs alone", () => {
    const { configurations, project } = fakeXcodeProject();

    plugin.stampMarketingVersion(project, "0.1.0");

    expect(configurations.FRAMEWORK_DEBUG.buildSettings.MARKETING_VERSION).toBe("1.0");
  });

  it("refuses a configuration without a version instead of shipping Xcode's default", () => {
    expect(() => plugin({})).toThrow(/version/);
    expect(() => plugin({ version: "  " })).toThrow(/version/);
  });
});
