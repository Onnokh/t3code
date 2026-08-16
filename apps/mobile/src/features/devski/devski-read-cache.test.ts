import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearDevskiCache,
  dropDevskiCacheEntries,
  readDevskiCacheEntry,
  writeDevskiCacheEntry,
} from "./devski-read-cache";

describe("devski read cache", () => {
  beforeEach(() => {
    clearDevskiCache();
  });

  it("returns what was written under the same key", () => {
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    expect(readDevskiCacheEntry("seo:status:missingmounts")).toEqual({ days: 515 });
  });

  it("keeps one subject's read out of another's", () => {
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    expect(readDevskiCacheEntry("seo:status:sleevy")).toBeNull();
  });

  it("reports a miss rather than undefined", () => {
    expect(readDevskiCacheEntry("seo:registry:missingmounts")).toBeNull();
  });

  it("ignores a null key, which means there is nothing to identify", () => {
    writeDevskiCacheEntry(null, { days: 515 });
    expect(readDevskiCacheEntry(null)).toBeNull();
  });

  it("drops one namespace and leaves the rest", () => {
    writeDevskiCacheEntry("automations:jobs", ["a"]);
    writeDevskiCacheEntry("automations:job:1", { id: "1" });
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });

    dropDevskiCacheEntries("automations:");

    expect(readDevskiCacheEntry("automations:jobs")).toBeNull();
    expect(readDevskiCacheEntry("automations:job:1")).toBeNull();
    expect(readDevskiCacheEntry("seo:status:missingmounts")).toEqual({ days: 515 });
  });

  it("drops everything when the credential changes", () => {
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    writeDevskiCacheEntry("automations:jobs", ["a"]);
    clearDevskiCache();
    expect(readDevskiCacheEntry("seo:status:missingmounts")).toBeNull();
    expect(readDevskiCacheEntry("automations:jobs")).toBeNull();
  });
});
