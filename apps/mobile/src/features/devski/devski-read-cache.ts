/**
 * The last value each Devski read produced, kept for the life of the process.
 *
 * Every Devski screen revalidates on focus, so without this, leaving an Area
 * and coming back — or switching Site and switching back — threw the data
 * away and showed a spinner for a round trip that almost always returns what
 * was on screen a moment ago. Entries are keyed by exactly what identifies a
 * read (the Site or the Job ID included), so one subject's data can never be
 * shown under another's, which is the property the loading state protected.
 *
 * This is a cache, not storage: it is memory-only, it does not survive a
 * relaunch, and it never suppresses the revalidation that follows it. Reads
 * of mutable things must drop their namespace when a mutation succeeds —
 * hydrating a Job list that predates the Job you just created would show the
 * user their own action being undone.
 */
const entries = new Map<string, unknown>();

export function readDevskiCacheEntry<T>(key: string | null): T | null {
  if (key === null) return null;
  const entry = entries.get(key);
  return entry === undefined ? null : (entry as T);
}

export function writeDevskiCacheEntry<T>(key: string | null, value: T): void {
  if (key === null) return;
  entries.set(key, value);
}

/** Drops every entry under one namespace, such as `automations:`. */
export function dropDevskiCacheEntries(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/**
 * Drops everything. Called when the environment or its credential changes,
 * so a re-pair — including one against a different environment — never
 * hydrates from the previous session's reads.
 */
export function clearDevskiCache(): void {
  entries.clear();
}
