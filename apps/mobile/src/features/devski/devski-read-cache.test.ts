import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearDevskiCache,
  devskiCacheFingerprint,
  dropDevskiCacheEntries,
  flushDevskiCache,
  openDevskiCacheSession,
  peekDevskiCacheEntry,
  readDevskiCacheEntry,
  setDevskiCacheStore,
  writeDevskiCacheEntry,
  type DevskiCacheStore,
} from "./devski-read-cache";

const ENVIRONMENT = "environment-1";
const FINGERPRINT = devskiCacheFingerprint("https://devski.example", "bearer-1");
const OTHER_FINGERPRINT = devskiCacheFingerprint("https://devski.example", "bearer-2");
const DAY_MS = 24 * 60 * 60 * 1000;

type FakeStore = DevskiCacheStore & {
  readonly records: Map<string, string>;
  readonly saved: () => number;
};

function fakeStore(records: Map<string, string> = new Map()): FakeStore {
  let saves = 0;
  return {
    records,
    saved: () => saves,
    load: (environmentId) => Promise.resolve(records.get(environmentId) ?? null),
    save: (environmentId, payload) => {
      saves += 1;
      records.set(environmentId, payload);
      return Promise.resolve();
    },
    remove: (environmentId) => {
      records.delete(environmentId);
      return Promise.resolve();
    },
  };
}

function storedSnapshot(input: {
  readonly fingerprint?: string;
  readonly environmentId?: string;
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly savedAt: number;
    readonly value: unknown;
  }>;
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    environmentId: input.environmentId ?? ENVIRONMENT,
    fingerprint: input.fingerprint ?? FINGERPRINT,
    entries: input.entries,
  });
}

/** Relaunches the app: a fresh process reads the stored record back. */
async function relaunch(store: FakeStore, fingerprint = FINGERPRINT): Promise<void> {
  openDevskiCacheSession(null);
  setDevskiCacheStore(store);
  openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint });
  await flushDevskiCache();
}

describe("devski read cache", () => {
  beforeEach(async () => {
    setDevskiCacheStore(null);
    openDevskiCacheSession(null);
    clearDevskiCache();
    await flushDevskiCache();
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

  it("is memory-only until a Session is open", async () => {
    const store = fakeStore();
    setDevskiCacheStore(store);
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    await flushDevskiCache();
    expect(store.saved()).toBe(0);
    expect(store.records.size).toBe(0);
  });

  it("draws the same Session's reads again after a relaunch", async () => {
    const store = fakeStore();
    setDevskiCacheStore(store);
    openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint: FINGERPRINT });
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    await flushDevskiCache();

    await relaunch(store);

    expect(readDevskiCacheEntry("seo:status:missingmounts")).toEqual({ days: 515 });
  });

  it("marks what came off this device, and unmarks it once a read confirms it", async () => {
    const store = fakeStore();
    setDevskiCacheStore(store);
    openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint: FINGERPRINT });
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    await flushDevskiCache();

    await relaunch(store);
    expect(peekDevskiCacheEntry("seo:status:missingmounts")).toMatchObject({
      value: { days: 515 },
      persisted: true,
    });

    writeDevskiCacheEntry("seo:status:missingmounts", { days: 516 });
    expect(peekDevskiCacheEntry("seo:status:missingmounts")).toMatchObject({
      value: { days: 516 },
      persisted: false,
    });
  });

  it("refuses a snapshot the same environment wrote under another credential", async () => {
    const store = fakeStore(
      new Map([
        [
          ENVIRONMENT,
          storedSnapshot({
            entries: [
              { key: "seo:status:missingmounts", savedAt: Date.now(), value: { days: 515 } },
            ],
          }),
        ],
      ]),
    );

    await relaunch(store, OTHER_FINGERPRINT);

    expect(readDevskiCacheEntry("seo:status:missingmounts")).toBeNull();
    expect(store.records.size).toBe(0);
  });

  it("refuses a snapshot that names another environment", async () => {
    const store = fakeStore(
      new Map([
        [
          ENVIRONMENT,
          storedSnapshot({
            environmentId: "environment-2",
            entries: [{ key: "seo:status:sleevy", savedAt: Date.now(), value: { days: 12 } }],
          }),
        ],
      ]),
    );

    await relaunch(store);

    expect(readDevskiCacheEntry("seo:status:sleevy")).toBeNull();
    expect(store.records.size).toBe(0);
  });

  it("refuses a snapshot from an unknown schema version", async () => {
    const store = fakeStore(
      new Map([
        [
          ENVIRONMENT,
          JSON.stringify({
            schemaVersion: 99,
            environmentId: ENVIRONMENT,
            fingerprint: FINGERPRINT,
            entries: [{ key: "seo:status:sleevy", savedAt: Date.now(), value: { days: 12 } }],
          }),
        ],
      ]),
    );

    await relaunch(store);

    expect(readDevskiCacheEntry("seo:status:sleevy")).toBeNull();
  });

  it("drops a stored entry that is older than the maximum age", async () => {
    const store = fakeStore(
      new Map([
        [
          ENVIRONMENT,
          storedSnapshot({
            entries: [
              { key: "seo:status:recent", savedAt: Date.now() - DAY_MS, value: { days: 515 } },
              { key: "seo:status:ancient", savedAt: Date.now() - 8 * DAY_MS, value: { days: 1 } },
            ],
          }),
        ],
      ]),
    );

    await relaunch(store);

    expect(readDevskiCacheEntry("seo:status:recent")).toEqual({ days: 515 });
    expect(readDevskiCacheEntry("seo:status:ancient")).toBeNull();
  });

  it("never lets a snapshot replace a read that already landed", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: DevskiCacheStore = {
      load: () =>
        pending.then(() =>
          storedSnapshot({
            entries: [{ key: "seo:status:missingmounts", savedAt: Date.now(), value: { days: 1 } }],
          }),
        ),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    setDevskiCacheStore(store);
    openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint: FINGERPRINT });

    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    release();
    await flushDevskiCache();

    expect(readDevskiCacheEntry("seo:status:missingmounts")).toEqual({ days: 515 });
  });

  it("removes the stored snapshot when the cache is cleared", async () => {
    const store = fakeStore();
    setDevskiCacheStore(store);
    openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint: FINGERPRINT });
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    await flushDevskiCache();
    expect(store.records.size).toBe(1);

    clearDevskiCache();
    await flushDevskiCache();

    expect(store.records.size).toBe(0);
  });

  it("stores a namespace drop, so a mutation is not undone by a relaunch", async () => {
    const store = fakeStore();
    setDevskiCacheStore(store);
    openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint: FINGERPRINT });
    writeDevskiCacheEntry("automations:jobs", ["a"]);
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    await flushDevskiCache();

    dropDevskiCacheEntries("automations:");
    await flushDevskiCache();
    await relaunch(store);

    expect(readDevskiCacheEntry("automations:jobs")).toBeNull();
    expect(readDevskiCacheEntry("seo:status:missingmounts")).toEqual({ days: 515 });
  });

  it("drops what the previous Session cached when another one opens", async () => {
    const store = fakeStore();
    setDevskiCacheStore(store);
    openDevskiCacheSession({ environmentId: ENVIRONMENT, fingerprint: FINGERPRINT });
    writeDevskiCacheEntry("seo:status:missingmounts", { days: 515 });
    await flushDevskiCache();

    openDevskiCacheSession({ environmentId: "environment-2", fingerprint: OTHER_FINGERPRINT });
    await flushDevskiCache();

    expect(readDevskiCacheEntry("seo:status:missingmounts")).toBeNull();
  });

  it("fingerprints the origin and the credential together", () => {
    expect(devskiCacheFingerprint("https://a.example", "bearer-1")).not.toBe(
      devskiCacheFingerprint("https://a.example", "bearer-2"),
    );
    expect(devskiCacheFingerprint("https://a.example", "bearer-1")).not.toBe(
      devskiCacheFingerprint("https://b.example", "bearer-1"),
    );
    expect(devskiCacheFingerprint("https://a.example", "bearer-1")).toBe(
      devskiCacheFingerprint("https://a.example", "bearer-1"),
    );
    // The digest is what gets stored, so it must not carry the credential.
    expect(devskiCacheFingerprint("https://a.example", "bearer-1")).not.toContain("bearer-1");
  });
});
