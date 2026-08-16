/**
 * The last value each SEO read produced, kept for the life of the process.
 *
 * Every SEO screen revalidates on focus, so without this, leaving a tab and
 * coming back — or switching Site and switching back — threw the data away
 * and showed a spinner for a round trip that almost always returns what was
 * on screen a moment ago. Entries are keyed by exactly what identifies a
 * read (the Site included), so one Site's data can never be shown under
 * another's, which is the property the loading state was protecting.
 *
 * This is a cache, not storage: it is memory-only and does not survive a
 * relaunch, and it never suppresses the revalidation that follows it. The
 * Gateway's own freshness metadata still decides what the screen calls the
 * data it is showing.
 */
const entries = new Map<string, unknown>();

export function readSeoCacheEntry<T>(key: string | null): T | null {
  if (key === null) return null;
  const entry = entries.get(key);
  return entry === undefined ? null : (entry as T);
}

export function writeSeoCacheEntry<T>(key: string | null, value: T): void {
  if (key === null) return;
  entries.set(key, value);
}

/**
 * Drops everything. Called when the environment or its credential changes,
 * so a re-pair — including one against a different environment — never
 * hydrates from the previous session's reads.
 */
export function clearSeoCache(): void {
  entries.clear();
}
