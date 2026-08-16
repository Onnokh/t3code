import { beforeEach, describe, expect, it } from "vite-plus/test";

import { clearSeoCache, readSeoCacheEntry, writeSeoCacheEntry } from "./seo-cache";

describe("seo cache", () => {
  beforeEach(() => {
    clearSeoCache();
  });

  it("returns what was written under the same key", () => {
    writeSeoCacheEntry("status:missingmounts", { days: 515 });
    expect(readSeoCacheEntry("status:missingmounts")).toEqual({ days: 515 });
  });

  it("keeps one Site's read out of another's", () => {
    writeSeoCacheEntry("status:missingmounts", { days: 515 });
    expect(readSeoCacheEntry("status:sleevy")).toBeNull();
  });

  it("reports a miss rather than undefined", () => {
    expect(readSeoCacheEntry("registry:missingmounts")).toBeNull();
  });

  it("ignores a null key, which means there is nothing to identify", () => {
    writeSeoCacheEntry(null, { days: 515 });
    expect(readSeoCacheEntry(null)).toBeNull();
  });

  it("drops everything when the credential changes", () => {
    writeSeoCacheEntry("status:missingmounts", { days: 515 });
    clearSeoCache();
    expect(readSeoCacheEntry("status:missingmounts")).toBeNull();
  });
});
