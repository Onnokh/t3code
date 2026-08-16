import { describe, expect, it } from "vite-plus/test";

import { codeTabBarDisplay, HOME_EMITS_BOTTOM_TOOLBAR } from "./devski-shell-chrome";

describe("codeTabBarDisplay", () => {
  it("shows the tab bar on the Code tab root", () => {
    expect(codeTabBarDisplay(undefined)).toBe("flex");
    expect(codeTabBarDisplay("Home")).toBe("flex");
  });

  it("hides the tab bar on routes T3 pushes full-screen", () => {
    expect(codeTabBarDisplay("Thread")).toBe("none");
    expect(codeTabBarDisplay("ThreadTerminal")).toBe("none");
    expect(codeTabBarDisplay("ThreadFile")).toBe("none");
  });

  it("keeps the tab bar under sheets, which leave the workspace visible", () => {
    expect(codeTabBarDisplay("SettingsSheet")).toBe("flex");
    expect(codeTabBarDisplay("NewTaskSheet")).toBe("flex");
    expect(codeTabBarDisplay("GitOverview")).toBe("flex");
  });
});

describe("HOME_EMITS_BOTTOM_TOOLBAR", () => {
  it("stays false so Home never stacks a toolbar on the tab bar", () => {
    expect(HOME_EMITS_BOTTOM_TOOLBAR).toBe(false);
  });
});
