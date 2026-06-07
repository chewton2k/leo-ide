import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldFollowCwd,
  rememberExpansion,
  recallExpansion,
  planExpansionRestore,
  clearExpansionCache,
} from '$lib/modules';

/**
 * Integration harness for the file-explorer expansion-preservation behavior.
 *
 * It mirrors the orchestration in FileTree.svelte's `followCwd` (terminal-cwd
 * follow) and `openFolderByPath` (project open), but drives the REAL shared
 * modules — `rememberExpansion` / `recallExpansion` / `planExpansionRestore`
 * / `shouldFollowCwd` — so the test exercises the production logic rather than
 * a re-implementation. `childLoads` records the directories whose children
 * were (re)fetched, in order, so we can assert the shallowest-first prefetch.
 */
function createExplorerHarness() {
  let rootPath: string | null = null;
  let expandedDirs = new Set<string>();
  let childLoads: string[] = [];

  /** Mirror of FileTree.followCwd(cwd). */
  function followCwd(cwd: string) {
    if (!shouldFollowCwd(rootPath, cwd)) return; // same-dir / null guard
    if (rootPath) rememberExpansion(rootPath, expandedDirs);
    rootPath = cwd;
    const recalled = recallExpansion(cwd);
    const { expanded, childLoadOrder } = planExpansionRestore(cwd, recalled);
    expandedDirs = expanded;
    // loadDirectory(root) fetches root children; renderExpandedChildren fetches
    // the rest. We only record the non-root prefetch order.
    for (const d of childLoadOrder) childLoads.push(d);
  }

  /** Mirror of FileTree.openFolderByPath(path, session.expanded_dirs). */
  function openFolderByPath(path: string, sessionDirs: string[] = []) {
    if (rootPath) rememberExpansion(rootPath, expandedDirs);
    rootPath = path;
    const recalled = recallExpansion(path);
    const seed = planExpansionRestore(path, recalled);
    expandedDirs = seed.expanded;
    for (const d of seed.childLoadOrder) childLoads.push(d);
    if (sessionDirs.length > 0) {
      const { expanded, childLoadOrder } = planExpansionRestore(path, recalled, sessionDirs);
      expandedDirs = expanded;
      for (const d of childLoadOrder) childLoads.push(d);
    }
  }

  /** Mirror of FileTree.toggleDir expand branch (user opens a folder). */
  function expandFolder(dir: string) {
    expandedDirs.add(dir);
  }

  function resetChildLoads() {
    childLoads = [];
  }

  return {
    followCwd,
    openFolderByPath,
    expandFolder,
    resetChildLoads,
    get rootPath() { return rootPath; },
    get expandedDirs() { return expandedDirs; },
    get childLoads() { return childLoads; },
  };
}

beforeEach(() => {
  clearExpansionCache();
});

describe('terminal-switch expansion preservation (followCwd)', () => {
  it('preserves a directory\u2019s open folders when switching away and back', () => {
    const h = createExplorerHarness();
    h.followCwd('/proj');
    h.expandFolder('/proj/src');
    h.expandFolder('/proj/src/lib');

    // Switch to a terminal in a different directory.
    h.followCwd('/other');
    expect(h.rootPath).toBe('/other');
    expect([...h.expandedDirs].sort()).toEqual(['/other']); // A's folders not shown here

    // Switch back: A's open folders are restored.
    h.followCwd('/proj');
    expect(h.rootPath).toBe('/proj');
    expect([...h.expandedDirs].sort()).toEqual(['/proj', '/proj/src', '/proj/src/lib']);
  });

  it('keeps each directory\u2019s expansion independent (no cross-leak)', () => {
    const h = createExplorerHarness();
    h.followCwd('/a');
    h.expandFolder('/a/src');

    h.followCwd('/b');
    h.expandFolder('/b/pkg');

    h.followCwd('/a');
    expect([...h.expandedDirs].sort()).toEqual(['/a', '/a/src']);

    h.followCwd('/b');
    expect([...h.expandedDirs].sort()).toEqual(['/b', '/b/pkg']);
  });

  it('a no-op switch to the same directory does not clobber open folders', () => {
    const h = createExplorerHarness();
    h.followCwd('/proj');
    h.expandFolder('/proj/src');
    h.resetChildLoads();

    h.followCwd('/proj'); // same dir → shouldFollowCwd is false → early return
    expect([...h.expandedDirs].sort()).toEqual(['/proj', '/proj/src']);
    expect(h.childLoads).toEqual([]); // no re-fetch
  });

  it('prefetches restored folders shallowest-first', () => {
    const h = createExplorerHarness();
    h.followCwd('/proj');
    h.expandFolder('/proj/a');
    h.expandFolder('/proj/a/b');
    h.expandFolder('/proj/a/b/c');

    h.followCwd('/away');
    h.resetChildLoads();
    h.followCwd('/proj'); // restore

    expect(h.childLoads).toEqual(['/proj/a', '/proj/a/b', '/proj/a/b/c']);
  });

  it('drops a remembered folder that no longer resolves under the root on return', () => {
    // Defensive: planExpansionRestore filters non-descendants.
    const h = createExplorerHarness();
    h.followCwd('/proj');
    h.expandFolder('/proj/src');
    h.followCwd('/away');
    // Re-entering /proj only restores descendants of /proj.
    h.followCwd('/proj');
    for (const d of h.expandedDirs) {
      expect(d === '/proj' || d.startsWith('/proj/')).toBe(true);
    }
  });
});

describe('project-open expansion preservation (openFolderByPath)', () => {
  it('unions in-memory recalled folders with on-disk session folders', () => {
    const h = createExplorerHarness();
    // Live session: cd around /proj and open a folder, then cd elsewhere so
    // /proj\u2019s expansion lands in the in-memory cache.
    h.followCwd('/proj');
    h.expandFolder('/proj/src');
    h.followCwd('/proj/sub'); // remembers /proj

    // Reopen /proj as a project with a DIFFERENT folder persisted on disk.
    h.openFolderByPath('/proj', ['/proj/docs']);
    expect([...h.expandedDirs].sort()).toEqual(['/proj', '/proj/docs', '/proj/src']);
  });

  it('restores the fresher in-memory expansion when reopening a project', () => {
    const h = createExplorerHarness();
    h.followCwd('/proj');
    h.expandFolder('/proj/src');
    h.followCwd('/proj/sub'); // cd out of /proj → /proj cached in memory

    // Reopen /proj with NO session dirs: the in-memory cache still restores it.
    h.openFolderByPath('/proj');
    expect([...h.expandedDirs].sort()).toEqual(['/proj', '/proj/src']);
  });

  it('remembers the outgoing project\u2019s folders so returning restores them', () => {
    const h = createExplorerHarness();
    h.openFolderByPath('/projA');
    h.expandFolder('/projA/src');

    h.openFolderByPath('/projB');
    expect([...h.expandedDirs].sort()).toEqual(['/projB']);

    h.openFolderByPath('/projA');
    expect([...h.expandedDirs].sort()).toEqual(['/projA', '/projA/src']);
  });
});
