import { defineRule } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, isIdentifier, unwrapExpression } from "../utils.ts";

// Hermes (the React Native engine) does not ship the ES2023 change-array-by-copy
// methods or the ES2024 grouping/async-from helpers. Calling one on Hermes throws
// `TypeError: undefined is not a function` at runtime, which the type checker
// cannot catch because the workspace lib target includes them.
const BANNED_INSTANCE_METHODS = new Map<string, string>([
  ["toSorted", "call .sort() on a copy ([...values].sort(...))"],
  ["toReversed", "call .reverse() on a copy ([...values].reverse())"],
  ["toSpliced", "call .splice() on a copy"],
  ["with", "assign into a copy ([...values] then copy[index] = value)"],
]);

const BANNED_STATIC_METHODS = new Map<string, Map<string, string>>([
  ["Object", new Map([["groupBy", "reduce into a Record instead of Object.groupBy"]])],
  ["Map", new Map([["groupBy", "reduce into a Map instead of Map.groupBy"]])],
  ["Array", new Map([["fromAsync", "collect with a for-await loop instead of Array.fromAsync"]])],
]);

// Scope: source Hermes can execute. Metro bundles apps/mobile plus the
// workspace roots it imports (the mobile package.json workspace dependencies
// and scripts/lib, which apps/mobile/src/lib/devski.ts reaches directly).
// Extend this list when the mobile app gains a new workspace dependency.
// Test files are excluded because they only ever run under Node.
const MOBILE_REACHABLE_PREFIXES = [
  "apps/mobile/",
  "packages/client-runtime/",
  "packages/contracts/",
  "packages/shared/",
  "scripts/lib/",
];
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const normalizePath = (path: string) => path.replaceAll("\\", "/");

const toRepoPath = (filename: string, cwd: string) => {
  const normalizedFilename = normalizePath(filename);
  const normalizedCwd = normalizePath(cwd).replace(/\/+$/u, "");
  const prefix = `${normalizedCwd}/`;
  return normalizedFilename.startsWith(prefix)
    ? normalizedFilename.slice(prefix.length)
    : normalizedFilename;
};

const isMobileReachableFile = (filename: string, cwd: string): boolean => {
  const repoPath = toRepoPath(filename, cwd);
  if (TEST_FILE_PATTERN.test(repoPath)) return false;
  return MOBILE_REACHABLE_PREFIXES.some(
    (dir) => repoPath.startsWith(dir) || repoPath.includes(`/${dir}`),
  );
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow ES2023+ methods that Hermes doesn't implement in mobile-reachable source.",
    },
  },
  create(context) {
    if (!isMobileReachableFile(context.filename, context.cwd)) return {};

    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (Option.isNone(callee) || callee.value.type !== "MemberExpression") return;

        const property = getPropertyName(callee.value.property);
        if (Option.isNone(property)) return;

        const object = unwrapExpression(callee.value.object);
        for (const [namespace, methods] of BANNED_STATIC_METHODS) {
          const suggestion = methods.get(property.value);
          if (suggestion !== undefined && isIdentifier(object, namespace)) {
            context.report({
              node: callee.value,
              message: `Hermes doesn't ship ${namespace}.${property.value}; ${suggestion}. Mobile-reachable code must stay Hermes-safe.`,
            });
            return;
          }
        }

        const suggestion = BANNED_INSTANCE_METHODS.get(property.value);
        if (suggestion === undefined) return;

        context.report({
          node: callee.value,
          message: `Hermes doesn't ship the ES2023 .${property.value}() method; ${suggestion}. Mobile-reachable code must stay Hermes-safe.`,
        });
      },
    };
  },
});
