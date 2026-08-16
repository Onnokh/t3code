import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

describe("t3code/no-hermes-incompatible-methods", () => {
  const mobileRule = createOxlintRuleHarness("t3code/no-hermes-incompatible-methods", {
    filename: "apps/mobile/src/fixture.ts",
  });
  const packageRule = createOxlintRuleHarness("t3code/no-hermes-incompatible-methods", {
    filename: "packages/client-runtime/src/fixture.ts",
  });
  const nodeOnlyRule = createOxlintRuleHarness("t3code/no-hermes-incompatible-methods", {
    filename: "apps/server/src/ws.ts",
  });
  const mobileTestRule = createOxlintRuleHarness("t3code/no-hermes-incompatible-methods", {
    filename: "apps/mobile/src/fixture.test.ts",
  });

  mobileRule.valid(
    "allows sorting a copy",
    `
      export const sorted = (values: ReadonlyArray<string>) => [...values].sort();
    `,
  );

  mobileRule.valid(
    "allows reversing a copy",
    `
      export const reversed = (values: ReadonlyArray<string>) => [...values].reverse();
    `,
  );

  mobileRule.valid(
    "allows Hermes-supported lookups",
    `
      export const last = (values: ReadonlyArray<number>) => values.findLast((value) => value > 0);
    `,
  );

  nodeOnlyRule.valid(
    "allows toSorted in Node-only server files",
    `
      export const sorted = (values: ReadonlyArray<string>) => values.toSorted();
    `,
  );

  mobileTestRule.valid(
    "allows toSorted in test files, which run under Node",
    `
      export const sorted = (values: ReadonlyArray<string>) => values.toSorted();
    `,
  );

  mobileRule.invalid(
    "reports toSorted in mobile source",
    `
      export const sorted = (values: ReadonlyArray<string>) => values.toSorted();
    `,
    (output) => {
      assert.match(output, /Hermes doesn't ship the ES2023 \.toSorted\(\) method/);
    },
  );

  mobileRule.invalid(
    "reports toReversed in mobile source",
    `
      export const reversed = (values: ReadonlyArray<string>) => values.toReversed();
    `,
    (output) => {
      assert.match(output, /\.toReversed\(\)/);
    },
  );

  mobileRule.invalid(
    "reports toSpliced in mobile source",
    `
      export const spliced = (values: ReadonlyArray<string>) => values.toSpliced(0, 1);
    `,
  );

  mobileRule.invalid(
    "reports the copying with() method in mobile source",
    `
      export const replaced = (values: ReadonlyArray<string>) => values.with(0, "first");
    `,
  );

  mobileRule.invalid(
    "reports Object.groupBy in mobile source",
    `
      export const grouped = (values: ReadonlyArray<string>) =>
        Object.groupBy(values, (value) => value.length);
    `,
    (output) => {
      assert.match(output, /Object\.groupBy/);
    },
  );

  mobileRule.invalid(
    "reports Map.groupBy in mobile source",
    `
      export const grouped = (values: ReadonlyArray<string>) =>
        Map.groupBy(values, (value) => value.length);
    `,
  );

  mobileRule.invalid(
    "reports Array.fromAsync in mobile source",
    `
      export const collect = (values: AsyncIterable<string>) => Array.fromAsync(values);
    `,
  );

  mobileRule.invalid(
    "reports optional-chained calls",
    `
      export const sorted = (values: ReadonlyArray<string> | undefined) => values?.toSorted();
    `,
  );

  packageRule.invalid(
    "reports toSorted in mobile-reachable workspace packages",
    `
      export const sorted = (values: ReadonlyArray<string>) => values.toSorted();
    `,
  );
});
