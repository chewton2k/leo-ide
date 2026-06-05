import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { activeTerminalCwd, shouldFollowCwd } from '$lib/modules';

interface Pane { id: number; cwd?: string }

function createExplorerHarness() {
  let explorerRoot: string | null = null;
  const panes = new Map<number, Pane>();

  /** Mirror of Terminal.svelte's createPane seeding + focusPane cwd line. */
  function spawnPane(id: number, spawnCwd: string | null) {
    panes.set(id, { id, cwd: spawnCwd ?? undefined }); // seed with spawn dir
  }
  /** OSC 7 report for a pane (e.g. after a `cd`). */
  function reportCwd(id: number, cwd: string) {
    const p = panes.get(id); if (p) p.cwd = cwd;
  }
  function focusPane(id: number) {
    const p = panes.get(id);
    if (p?.cwd) activeTerminalCwd.set(p.cwd); // focusPane: re-root to pane.cwd
  }

  // The FileTree effect: re-root when activeTerminalCwd changes.
  const unsub = activeTerminalCwd.subscribe((cwd) => {
    if (cwd && shouldFollowCwd(explorerRoot, cwd)) explorerRoot = cwd;
  });

  return {
    spawnPane, reportCwd, focusPane,
    get explorerRoot() { return explorerRoot; },
    dispose: unsub,
  };
}

describe('explorer follows focused terminal pane cwd', () => {
  let h: ReturnType<typeof createExplorerHarness>;
  beforeEach(() => { activeTerminalCwd.set(null); h = createExplorerHarness(); });
  afterEach(() => { h.dispose(); activeTerminalCwd.set(null); });

  it('a freshly spawned pane carries its spawn cwd, so focus re-roots WITHOUT a command', () => {
    h.spawnPane(1, '/proj');
    h.focusPane(1);
    expect(get(activeTerminalCwd)).toBe('/proj');
    expect(h.explorerRoot).toBe('/proj');
  });

  it('switching between two terminals follows each pane cwd immediately', () => {
    h.spawnPane(1, '/proj');
    h.spawnPane(2, '/proj');           // both spawn at project root
    h.reportCwd(2, '/proj/packages/api'); // pane 2 cd'd (OSC 7 received post-attach)

    h.focusPane(1);
    expect(h.explorerRoot).toBe('/proj');

    h.focusPane(2);                    // click the other terminal
    expect(h.explorerRoot).toBe('/proj/packages/api');

    h.focusPane(1);                    // back to the first
    expect(h.explorerRoot).toBe('/proj');
  });

  it('without seeding (the bug), focus cannot re-root until an OSC 7 arrives', () => {
    // Pane created with NO cwd (the pre-fix state where startup OSC 7 was lost).
    h.spawnPane(1, null);
    h.focusPane(1);
    expect(get(activeTerminalCwd)).toBeNull(); // explorer stuck — the reported bug

    // Only after running a command (OSC 7) does it follow.
    h.reportCwd(1, '/proj');
    h.focusPane(1);
    expect(h.explorerRoot).toBe('/proj');
  });
});
