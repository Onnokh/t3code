import { describe, expect, it, vi } from "vite-plus/test";

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
  createLiveActivity: vi.fn((name: string, layout: unknown) => ({ layout, name })),
}));

import {
  AgentActivity,
  type AgentActivityProps,
  type AgentActivityRowProps,
} from "./AgentActivity";

function makeRow(overrides: Partial<AgentActivityRowProps>): AgentActivityRowProps {
  return {
    environmentId: "env-1",
    threadId: "thread-1",
    projectTitle: "Project",
    threadTitle: "Thread",
    modelTitle: "gpt-5.4",
    phase: "running",
    status: "Working",
    updatedAt: "2026-05-25T13:07:00.000Z",
    deepLink: "/threads/env-1/thread-1",
    ...overrides,
  };
}

const props = {
  title: "T3 Code",
  subtitle: "Agent work in progress",
  activeCount: 1,
  updatedAt: "2026-05-25T13:07:00.000Z",
  activities: [],
} satisfies AgentActivityProps;

const environment = {
  colorScheme: "dark",
  isLuminanceReduced: false,
} as const;

const lightEnvironment = {
  colorScheme: "light",
  isLuminanceReduced: false,
} as const;

describe("AgentActivity widget layout", () => {
  it("tints each row by its own phase using the web sidebar's dark palette", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_approval", status: "Approval" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("#7dd3fc"); // sky-300: running
    expect(banner).toContain("#fcd34d"); // amber-300: waiting_for_approval
  });

  it("switches to the web sidebar's light palette when the scheme is light", () => {
    // macOS (iPhone Mirroring / Mac notification center) renders the activity
    // on a light background; the dark-material palette is illegible there.
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_approval", status: "Approval" }),
        ],
      },
      lightEnvironment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("#0284c7"); // sky-600: running
    expect(banner).toContain("#d97706"); // amber-600: waiting_for_approval
    expect(banner).not.toContain("#7dd3fc");
    expect(banner).not.toContain("#fcd34d");
  });

  it("orders rows attention-first in the banner", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({ threadTitle: "Working thread" }),
          makeRow({
            threadId: "thread-2",
            threadTitle: "Blocked thread",
            phase: "waiting_for_approval",
            status: "Approval",
          }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner.indexOf("Blocked thread")).toBeGreaterThan(-1);
    expect(banner.indexOf("Blocked thread")).toBeLessThan(banner.indexOf("Working thread"));
  });

  it("summarizes the attention count in the banner header", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 3,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_input", status: "Input" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("3 active agents");
    expect(banner).toContain("1 needs attention");
  });

  it("uses the attention tint for the compact presentations when a row needs input", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_input", status: "Input" }),
        ],
      },
      environment as never,
    );
    expect(JSON.stringify(layout.compactLeading)).toContain("#a5b4fc"); // indigo-300
    expect(JSON.stringify(layout.compactTrailing)).toContain("Input");
    expect(JSON.stringify(layout.minimal)).toContain("#a5b4fc");
  });

  it("deep links the banner to the row that needs attention", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({
            threadId: "thread-2",
            phase: "waiting_for_approval",
            status: "Approval",
            deepLink: "/threads/env-1/thread-2",
          }),
        ],
      },
      environment as never,
    );
    expect(JSON.stringify(layout.banner)).toContain(
      '"widgetURL":"devski://threads/env-1/thread-2"',
    );
  });

  it("deep links the banner to the first row when nothing needs attention", () => {
    const layout = AgentActivity({ ...props, activities: [makeRow({})] }, environment as never);
    expect(JSON.stringify(layout.banner)).toContain(
      '"widgetURL":"devski://threads/env-1/thread-1"',
    );
  });

  it("omits the deep link for unsafe paths and empty aggregates", () => {
    expect(JSON.stringify(AgentActivity(props, environment as never))).not.toContain("widgetURL");
    expect(
      JSON.stringify(
        AgentActivity(
          { ...props, activities: [makeRow({ deepLink: "//evil.example" })] },
          environment as never,
        ),
      ),
    ).not.toContain("widgetURL");
  });

  it("leads with the outcome instead of a zero count when nothing is active", () => {
    const layout = AgentActivity(
      {
        ...props,
        subtitle: "Agent work completed",
        activeCount: 0,
        activities: [makeRow({ phase: "completed", status: "Done" })],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("Agent work completed");
    expect(banner).not.toContain("0 active");
    expect(banner).toContain("#6ee7b7"); // emerald-300 header tint
    expect(JSON.stringify(layout.compactTrailing)).toContain("Done");
    expect(JSON.stringify(layout.compactTrailing)).not.toContain("0 active");
    expect(JSON.stringify(layout.expandedLeading)).toContain("Done");
    expect(JSON.stringify(layout.minimal)).toContain("checkmark.circle.fill");
    expect(JSON.stringify(layout.bannerSmall)).toContain("Done");
  });

  it("reads Failed when the finished work ended in failure", () => {
    const layout = AgentActivity(
      {
        ...props,
        subtitle: "Agent work failed",
        activeCount: 0,
        activities: [makeRow({ phase: "failed", status: "Failed" })],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("Agent work failed");
    expect(banner).toContain("#fca5a5"); // red-300 header tint
    expect(JSON.stringify(layout.compactTrailing)).toContain("Failed");
    expect(JSON.stringify(layout.expandedLeading)).toContain("Failed");
    expect(JSON.stringify(layout.minimal)).toContain("xmark.octagon.fill");
  });

  it("lets a failure dominate mixed finished outcomes across every presentation", () => {
    const layout = AgentActivity(
      {
        ...props,
        // The server subtitle keys off the newest terminal row (completed
        // here); the layout must still read Failed everywhere so the header
        // text never disagrees with the tint, count slots, or minimal glyph.
        subtitle: "Agent work completed",
        activeCount: 0,
        activities: [
          makeRow({ phase: "completed", status: "Done" }),
          makeRow({ threadId: "thread-2", phase: "failed", status: "Failed" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("Agent work failed");
    expect(banner).not.toContain("Agent work completed");
    expect(banner).toContain("#fca5a5"); // red-300 header tint
    expect(JSON.stringify(layout.compactTrailing)).toContain("Failed");
    expect(JSON.stringify(layout.expandedLeading)).toContain("Failed");
    expect(JSON.stringify(layout.minimal)).toContain("xmark.octagon.fill");
  });

  it("renders Automation Runs with the Run vocabulary and terminal phases (PLO-420)", () => {
    const automationRow = (overrides: Partial<AgentActivityRowProps>) =>
      makeRow({
        source: "automation",
        environmentId: "automations",
        projectTitle: "Automation",
        modelTitle: "Run",
        deepLink: "/automations/runs/run-1",
        ...overrides,
      });

    const active = AgentActivity(
      {
        ...props,
        activeCount: 1,
        activities: [
          automationRow({ threadId: "run-1", threadTitle: "nightly-sync", status: "Running" }),
        ],
      },
      environment as never,
    );
    const activeBanner = JSON.stringify(active.banner);
    expect(activeBanner).toContain("1 active Run");
    expect(activeBanner).not.toContain("agent");
    expect(activeBanner).toContain("nightly-sync");
    expect(activeBanner).toContain('{"widgetURL":"devski://automations/runs/run-1"}');

    // A timed-out Run alerts like a failure: red tint, failure priority.
    const timedOut = AgentActivity(
      {
        ...props,
        activeCount: 0,
        activities: [
          automationRow({
            threadId: "run-2",
            threadTitle: "slow-job",
            phase: "timed_out",
            status: "Timed out",
          }),
          automationRow({
            threadId: "run-3",
            threadTitle: "good-job",
            phase: "succeeded",
            status: "Succeeded",
          }),
        ],
      },
      environment as never,
    );
    const timedOutBanner = JSON.stringify(timedOut.banner);
    expect(timedOutBanner).toContain("Automation Run failed");
    expect(timedOutBanner).toContain("#fca5a5"); // red-300: timed_out alerts like failed
    expect(timedOutBanner).toContain("#6ee7b7"); // emerald-300: succeeded

    // A mixed aggregate keeps the existing agent wording.
    const mixed = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          automationRow({ threadId: "run-4", threadTitle: "nightly-sync", status: "Running" }),
        ],
      },
      environment as never,
    );
    expect(JSON.stringify(mixed.banner)).toContain("2 active agents");
  });

  it("renders up to five rows in the banner", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 6,
        activities: [1, 2, 3, 4, 5, 6].map((n) =>
          makeRow({ threadId: `t${n}`, threadTitle: `Thread ${n}` }),
        ),
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    for (const visible of [1, 2, 3, 4, 5]) {
      expect(banner).toContain(`Thread ${visible}`);
    }
    expect(banner).not.toContain("Thread 6");
  });
});
