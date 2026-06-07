/**
 * Per-root expansion cache for the file explorer.
 *
 * When the explorer re-roots — most
 * commonly because the focused terminal pane/tab reports a new working
 * directory — we must NOT throw away which folders the user had open. This
 * cache remembers the expanded set keyed by root path on the way out, and
 * restores it on the way back, so switching between terminals (or `cd`-ing
 * around) preserves "what folders are open".
 *
 * LRU-bounded so a long session that visits many directories can't grow the
 * map without limit; the least-recently-used root is evicted first.
 */

export const EXPANSION_CACHE_LIMIT = 8;

const cache = new Map<string, string[]>();

/** True when `key` is `root` itself or a descendant path of `root`. */
function isUnder(key: string, root: string): boolean {
  if (key === root) return true;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return key.startsWith(prefix);
}

/**
 * Remember the directories expanded under `root`. The root itself is implicit
 * (always re-expanded on restore) so it is not stored as an entry. Storing an
 * empty set removes any prior entry rather than caching nothing useful.
 */
export function rememberExpansion(root: string, expanded: Iterable<string>): void {
  const children = [...expanded].filter((p) => p !== root && isUnder(p, root));
  cache.delete(root);
  if (children.length > 0) cache.set(root, children);
  while (cache.size > EXPANSION_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Return the cached expanded directories for `root` (excluding the root),
 * filtered to those still under it. Recalling bumps the root's recency so a
 * directory you keep returning to survives eviction. Returns `[]` when nothing
 * is cached.
 */
export function recallExpansion(root: string): string[] {
  const v = cache.get(root);
  if (!v) return [];
  // Bump LRU recency: delete + re-insert moves it to the most-recent slot.
  cache.delete(root);
  cache.set(root, v);
  return v.filter((p) => isUnder(p, root));
}

/** Test/utility helpers. */
export function clearExpansionCache(): void {
  cache.clear();
}

export function expansionCacheSize(): number {
  return cache.size;
}

/**
 * Plan how to restore the explorer's expanded folders when (re)rooting to
 * `root`. Unions the in-memory recalled dirs with optional persisted session
 * dirs, keeps only descendants of `root`, always includes `root` itself, and
 * returns the non-root dirs ordered shallowest-first so a parent's children
 * are fetched before a descendant's.
 *
 * Pure and deterministic — this is the core restore logic shared by both
 * re-root paths (terminal-cwd follow and project open).
 */
export function planExpansionRestore(
  root: string,
  recalled: string[],
  sessionDirs: string[] = [],
): { expanded: Set<string>; childLoadOrder: string[] } {
  const dirs = [...recalled, ...sessionDirs].filter((p) => p !== root && isUnder(p, root));
  const expanded = new Set<string>([root, ...dirs]);
  const childLoadOrder = [...expanded]
    .filter((d) => d !== root)
    .sort((a, b) => a.split('/').length - b.split('/').length);
  return { expanded, childLoadOrder };
}
