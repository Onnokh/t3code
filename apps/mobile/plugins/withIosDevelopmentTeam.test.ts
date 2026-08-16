import * as NodeModule from "node:module";

import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const plugin = require("./withIosDevelopmentTeam.cjs") as ((config: unknown) => unknown) & {
  stampDevelopmentTeam: (project: unknown, appleTeamId: string) => ReadonlyArray<string>;
};

function buildSettings(productName: string) {
  return { isa: "XCBuildConfiguration", buildSettings: { PRODUCT_NAME: productName } };
}

/**
 * The share extension target reproduces the regression: expo-sharing creates
 * it without a DEVELOPMENT_TEAM, and the framework target proves that only
 * signable targets are stamped.
 */
function fakeXcodeProject() {
  const configurations = {
    APP_DEBUG: buildSettings('"DevskiDev"'),
    APP_RELEASE: buildSettings('"DevskiDev"'),
    SHARE_DEBUG: buildSettings('"$(TARGET_NAME)"'),
    WIDGET_DEBUG: buildSettings('"$(TARGET_NAME)"'),
    FRAMEWORK_DEBUG: buildSettings('"$(TARGET_NAME)"'),
  };
  const projectSection = { PROJECT: { attributes: {} }, PROJECT_comment: "Project object" };

  return {
    configurations,
    projectSection,
    project: {
      pbxNativeTargetSection: () => ({
        APP: {
          name: "DevskiDev",
          productType: '"com.apple.product-type.application"',
          buildConfigurationList: "LIST_APP",
        },
        APP_comment: "DevskiDev",
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
      pbxProjectSection: () => projectSection,
    },
  };
}

describe("withIosDevelopmentTeam", () => {
  it("stamps one Apple team onto every signable target, extensions included", () => {
    const { configurations, projectSection, project } = fakeXcodeProject();

    expect(plugin.stampDevelopmentTeam(project, "5Q5AZ5596L")).toEqual([
      "DevskiDev",
      "expo-sharing-extension",
      "ExpoWidgetsTarget",
    ]);

    expect(configurations.APP_DEBUG.buildSettings).toMatchObject({
      DEVELOPMENT_TEAM: "5Q5AZ5596L",
    });
    expect(configurations.APP_RELEASE.buildSettings).toMatchObject({
      DEVELOPMENT_TEAM: "5Q5AZ5596L",
    });
    expect(configurations.SHARE_DEBUG.buildSettings).toMatchObject({
      DEVELOPMENT_TEAM: "5Q5AZ5596L",
    });
    expect(configurations.WIDGET_DEBUG.buildSettings).toMatchObject({
      DEVELOPMENT_TEAM: "5Q5AZ5596L",
    });
    expect(projectSection.PROJECT.attributes).toEqual({
      TargetAttributes: {
        APP: { DevelopmentTeam: "5Q5AZ5596L" },
        SHARE: { DevelopmentTeam: "5Q5AZ5596L" },
        WIDGET: { DevelopmentTeam: "5Q5AZ5596L" },
      },
    });
  });

  it("leaves targets that Xcode never signs alone", () => {
    const { configurations, project } = fakeXcodeProject();

    plugin.stampDevelopmentTeam(project, "5Q5AZ5596L");

    expect(configurations.FRAMEWORK_DEBUG.buildSettings).not.toHaveProperty("DEVELOPMENT_TEAM");
  });

  it("refuses a configuration without an Apple team instead of signing with a keychain team", () => {
    expect(() => plugin({ ios: {} })).toThrow(/ios\.appleTeamId/);
    expect(() => plugin({ ios: { appleTeamId: "  " } })).toThrow(/ios\.appleTeamId/);
  });
});
