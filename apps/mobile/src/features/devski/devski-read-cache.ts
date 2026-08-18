/**
 * The last value each Devski read produced, kept for this device.
 *
 * Every Devski screen revalidates on focus, so without this, leaving an Area
 * and coming back — or switching Site and switching back — threw the data
 * away and showed a spinner for a round trip that almost always returns what
 * was on screen a moment ago. Entries are keyed by exactly what identifies a
 * read (the Site or the Job ID included), so one subject's data can never be
 * shown under another's, which is the property the loading state protected.
 *
 * Memory answers every read; persistence only refills memory at launch, so a
 * cold start draws the screen the owner saw yesterday instead of a spinner.
 * This stays a cache, not storage: it never suppresses the revalidation that
 * follows it. Reads of mutable things must drop their namespace when a
 * mutation succeeds — hydrating a Job list that predates the Job you just
 * created would show the user their own action being undone.
 *
 * Persistence is scoped to one Session (see `DevskiCacheSession`). A stored
 * snapshot is only ever read back into the Session that wrote it, so a
 * re-pair, a new credential, or a different environment cannot hydrate the
 * previous session's reads even if removing the record failed.
 */

import { useCallback, useSyncExternalStore } from "react";

/**
 * The identity a stored snapshot belongs to: the paired environment plus a
 * digest of the credential that read it. Matching on both is what makes the
 * clearing reliable — removing the record is best effort, refusing to read a
 * record that does not match is not.
 */
export type DevskiCacheSession = {
  readonly environmentId: string;
  readonly fingerprint: string;
};

/** Where a snapshot is kept. One record per environment, replaced whole. */
export type DevskiCacheStore = {
  readonly load: (environmentId: string) => Promise<string | null>;
  readonly save: (environmentId: string, payload: string) => Promise<void>;
  readonly remove: (environmentId: string) => Promise<void>;
};

/** One cached read, and whether a read has confirmed it in this process. */
export type DevskiCacheEntry<T> = {
  readonly value: T;
  /**
   * True while this value comes from the stored snapshot and no read has
   * confirmed it yet. Screens use it to say so; see `MAX_PERSISTED_AGE_MS`
   * for why the marker is limited to this case.
   */
  readonly persisted: boolean;
};

const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * A stored entry older than this is dropped at launch rather than drawn.
 *
 * `freshness.syncedAt` is always null, so a screen cannot tell the owner how
 * old a hydrated payload is; the honest signals are the coverage dates, and a
 * week-old payload's window has moved on. Dropping costs only the instant
 * paint in the one case where that paint would mislead, because the
 * revalidation runs either way. Inside the limit the entry is drawn but
 * marked `persisted`, which is the visible "not confirmed yet" the SEO
 * screens show until the live read lands.
 */
const MAX_PERSISTED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StoredEntry = { readonly key: string; readonly savedAt: number; readonly value: unknown };

type StoredSnapshot = {
  readonly schemaVersion: number;
  readonly environmentId: string;
  readonly fingerprint: string;
  readonly entries: readonly StoredEntry[];
};

type Entry = { readonly value: unknown; readonly persisted: boolean; readonly savedAt: number };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

let session: DevskiCacheSession | null = null;
let store: DevskiCacheStore | null = null;
let hydration: Promise<void> = Promise.resolve();
// One writer, in order: a save and a removal must never race for the record.
let queue: Promise<void> = Promise.resolve();
let saveQueued = false;
let dirty = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function sameSession(left: DevskiCacheSession | null, right: DevskiCacheSession | null): boolean {
  if (left === null || right === null) return left === right;
  return left.environmentId === right.environmentId && left.fingerprint === right.fingerprint;
}

// FNV-1a twice, with different seeds, the way the diff and review caches
// already key their payloads. Two 32-bit passes separate credentials without
// storing anything a credential could be read back from.
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x85ebca6b;
const SECONDARY_HASH_MULTIPLIER = 0xc2b2ae35;

function fnv1a32(input: string, seed: number, multiplier: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The digest a snapshot is matched against. Both the origin and the Device
 * Session bearer take part, so a re-pair against the same environment does
 * not match the snapshot the previous session wrote.
 */
export function devskiCacheFingerprint(httpBaseUrl: string, bearerToken: string): string {
  const input = `${httpBaseUrl} ${bearerToken}`;
  const primary = fnv1a32(input, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(input, SECONDARY_HASH_SEED, SECONDARY_HASH_MULTIPLIER).toString(36);
  return `${primary}${secondary}`;
}

/** Installs where snapshots are kept. Without one the cache is memory-only. */
export function setDevskiCacheStore(next: DevskiCacheStore | null): void {
  store = next;
}

function parseSnapshot(raw: string): StoredSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<StoredSnapshot>;
  if (candidate.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  if (typeof candidate.environmentId !== "string" || typeof candidate.fingerprint !== "string") {
    return null;
  }
  if (!Array.isArray(candidate.entries)) return null;
  return candidate as StoredSnapshot;
}

function serializeSnapshot(current: DevskiCacheSession): string | null {
  const stored: StoredSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    environmentId: current.environmentId,
    fingerprint: current.fingerprint,
    entries: [...entries].map(([key, entry]) => ({
      key,
      savedAt: entry.savedAt,
      value: entry.value,
    })),
  };
  try {
    return JSON.stringify(stored);
  } catch {
    // Everything cached here came out of a JSON response; anything that
    // cannot go back is not worth failing a screen over.
    return null;
  }
}

function enqueue(task: () => Promise<void>): void {
  // A cache that cannot write is still a cache, so nothing here can reject.
  queue = queue.then(task).catch(() => undefined);
}

function queueSave(): void {
  if (session === null || store === null) return;
  dirty = true;
  // One write per batch of changes: the record is replaced whole, so there is
  // nothing to merge and no intermediate state worth storing.
  if (saveQueued) return;
  saveQueued = true;
  enqueue(async () => {
    saveQueued = false;
    if (!dirty) return;
    dirty = false;
    const current = session;
    const target = store;
    if (current === null || target === null) return;
    const payload = serializeSnapshot(current);
    if (payload === null) return;
    await target.save(current.environmentId, payload);
  });
}

async function hydrate(current: DevskiCacheSession, target: DevskiCacheStore): Promise<void> {
  let raw: string | null;
  try {
    raw = await target.load(current.environmentId);
  } catch {
    return;
  }
  // The Session may have changed while the record was read; a snapshot is
  // only ever merged into the Session it was written for.
  if (!sameSession(session, current)) return;
  if (raw === null) return;
  const snapshot = parseSnapshot(raw);
  const usable =
    snapshot !== null &&
    snapshot.environmentId === current.environmentId &&
    snapshot.fingerprint === current.fingerprint;
  if (!usable) {
    try {
      await target.remove(current.environmentId);
    } catch {
      // Refusing to read a record that does not match is what protects the
      // owner; removing it only reclaims the space.
    }
    return;
  }
  const oldest = Date.now() - MAX_PERSISTED_AGE_MS;
  let merged = false;
  for (const stored of snapshot.entries) {
    if (typeof stored?.key !== "string" || typeof stored.savedAt !== "number") continue;
    if (stored.savedAt < oldest) continue;
    // A read that already landed wins: the snapshot refills memory, it never
    // replaces what the Gateway just said.
    if (entries.has(stored.key)) continue;
    entries.set(stored.key, { value: stored.value, persisted: true, savedAt: stored.savedAt });
    merged = true;
  }
  if (merged) notify();
}

/**
 * Points the cache at one Session, dropping everything the previous one
 * cached and refilling memory from that Session's own snapshot. Calling it
 * again with the same Session does nothing, so every Area may call it.
 */
export function openDevskiCacheSession(next: DevskiCacheSession | null): void {
  if (sameSession(session, next)) return;
  entries.clear();
  dirty = false;
  session = next;
  notify();
  const target = store;
  if (next === null || target === null) return;
  hydration = hydrate(next, target);
}

/** Settles the pending snapshot read and writes. For tests and teardown. */
export async function flushDevskiCache(): Promise<void> {
  await hydration;
  let settled: Promise<void> | null = null;
  while (settled !== queue) {
    settled = queue;
    await settled;
  }
}

export function readDevskiCacheEntry<T>(key: string | null): T | null {
  if (key === null) return null;
  const entry = entries.get(key);
  return entry === undefined ? null : (entry.value as T);
}

export function writeDevskiCacheEntry<T>(key: string | null, value: T): void {
  if (key === null) return;
  entries.set(key, { value, persisted: false, savedAt: Date.now() });
  queueSave();
  notify();
}

/** Drops every entry under one namespace, such as `automations:`. */
export function dropDevskiCacheEntries(prefix: string): void {
  let dropped = false;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
      dropped = true;
    }
  }
  if (!dropped) return;
  queueSave();
  notify();
}

/**
 * Drops everything, in memory and on this device, for the Session that is
 * open. Called when this device stops being paired, so nothing of the
 * previous session's reads is left to hydrate. An environment or credential
 * change goes through `openDevskiCacheSession` instead, which drops what the
 * previous Session cached and refuses its stored snapshot.
 */
export function clearDevskiCache(): void {
  entries.clear();
  dirty = false;
  const current = session;
  const target = store;
  if (current !== null && target !== null) {
    enqueue(() => target.remove(current.environmentId));
  }
  notify();
}

/**
 * One key's cached read with its origin, or null for a miss. The non-React
 * form of `useDevskiCacheEntry`.
 */
export function peekDevskiCacheEntry<T>(key: string | null): DevskiCacheEntry<T> | null {
  if (key === null) return null;
  return (entries.get(key) as DevskiCacheEntry<T> | undefined) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One key's cached read, or null for a miss. Re-reads when the stored
 * snapshot lands, so a screen mounted before hydration finished still draws
 * from the cache instead of waiting for its own round trip.
 */
export function useDevskiCacheEntry<T>(key: string | null): DevskiCacheEntry<T> | null {
  // The entry object is replaced on every write, so handing it back directly
  // is a stable snapshot for as long as the value is unchanged.
  const getSnapshot = useCallback(() => peekDevskiCacheEntry<T>(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
