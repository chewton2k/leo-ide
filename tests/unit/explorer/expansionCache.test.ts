import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberExpansion,
  recallExpansion,
  clearExpansionCache,
  expansionCacheSize,
  planExpansionRestore,
  EXPANSION_CACHE_LIMIT,
} from '$lib/modules/explorer/expansionCache';

beforeEach(() => {
  clearExpansionCache();
});

describe('rememberExpansion / recallExpansion', () => {
  it('round-trips the expanded dirs for a root (excluding the root itself)', () => {
    rememberExpansion('/proj', new Set(['/proj', '/proj/src', '/proj/src/lib']));
    // The root itself is implicit and not stored as a child entry.
    expect(recallExpansion('/proj').sort()).toEqual(['/proj/src', '/proj/src/lib']);
  });

  it('returns an empty array for an unknown root', () => {
    expect(recallExpansion('/never-seen')).toEqual([]);
  });

  it('overwrites a previous entry for the same root', () => {
    rememberExpansion('/proj', new Set(['/proj/a']));
    rememberExpansion('/proj', new Set(['/proj/b', '/proj/c']));
    expect(recallExpansion('/proj').sort()).toEqual(['/proj/b', '/proj/c']);
  });

  it('does not store an entry when only the root is expanded', () => {
    rememberExpansion('/proj', new Set(['/proj']));
    expect(expansionCacheSize()).toBe(0);
    expect(recallExpansion('/proj')).toEqual([]);
  });

  it('only recalls entries that are still under the requested root', () => {
    // Defensive: a stale entry outside the root must not be resurrected.
    rememberExpansion('/proj', new Set(['/proj/src', '/elsewhere/x']));
    expect(recallExpansion('/proj')).toEqual(['/proj/src']);
  });

  it('keeps two different roots independent', () => {
    rememberExpansion('/a', new Set(['/a/one']));
    rememberExpansion('/b', new Set(['/b/two']));
    expect(recallExpansion('/a')).toEqual(['/a/one']);
    expect(recallExpansion('/b')).toEqual(['/b/two']);
  });
});

describe('LRU eviction', () => {
  it('evicts the least-recently-used root beyond the cap', () => {
    for (let i = 0; i < EXPANSION_CACHE_LIMIT; i++) {
      rememberExpansion(`/root${i}`, new Set([`/root${i}/child`]));
    }
    expect(expansionCacheSize()).toBe(EXPANSION_CACHE_LIMIT);
    // Adding one more evicts the oldest (/root0).
    rememberExpansion('/rootNew', new Set(['/rootNew/child']));
    expect(expansionCacheSize()).toBe(EXPANSION_CACHE_LIMIT);
    expect(recallExpansion('/root0')).toEqual([]);
    expect(recallExpansion('/rootNew')).toEqual(['/rootNew/child']);
  });

  it('recall bumps recency so a recalled root survives later eviction', () => {
    for (let i = 0; i < EXPANSION_CACHE_LIMIT; i++) {
      rememberExpansion(`/root${i}`, new Set([`/root${i}/child`]));
    }
    // Touch /root0 so it becomes most-recently-used.
    expect(recallExpansion('/root0')).toEqual(['/root0/child']);
    // Add a new root: the now-oldest (/root1) should be evicted, not /root0.
    rememberExpansion('/rootNew', new Set(['/rootNew/child']));
    expect(recallExpansion('/root0')).toEqual(['/root0/child']);
    expect(recallExpansion('/root1')).toEqual([]);
  });
});

describe('planExpansionRestore', () => {
  it('always includes the root and excludes it from the child-load order', () => {
    const { expanded, childLoadOrder } = planExpansionRestore('/proj', []);
    expect(expanded.has('/proj')).toBe(true);
    expect(childLoadOrder).toEqual([]);
  });

  it('unions recalled dirs with persisted session dirs (deduped)', () => {
    const { expanded } = planExpansionRestore(
      '/proj',
      ['/proj/src'],
      ['/proj/src', '/proj/docs'],
    );
    expect([...expanded].sort()).toEqual(['/proj', '/proj/docs', '/proj/src']);
  });

  it('drops entries that are not descendants of the root', () => {
    const { expanded, childLoadOrder } = planExpansionRestore(
      '/proj',
      ['/proj/src', '/elsewhere/x'],
      ['/other/y'],
    );
    expect([...expanded].sort()).toEqual(['/proj', '/proj/src']);
    expect(childLoadOrder).toEqual(['/proj/src']);
  });

  it('orders child loads shallowest-first so parents load before descendants', () => {
    const { childLoadOrder } = planExpansionRestore('/proj', [
      '/proj/a/b/c',
      '/proj/a',
      '/proj/a/b',
    ]);
    expect(childLoadOrder).toEqual(['/proj/a', '/proj/a/b', '/proj/a/b/c']);
  });

  it('is deterministic and does not mutate the cache', () => {
    const before = expansionCacheSize();
    planExpansionRestore('/proj', ['/proj/src']);
    planExpansionRestore('/proj', ['/proj/src']);
    expect(expansionCacheSize()).toBe(before);
  });
});
