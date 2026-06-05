/**
 * Regression: tab-mode split terminals — clicking the ORIGINAL pane after a
 * split must hand it keyboard focus. (Panel mode always worked.)
 *
 * ROOT CAUSE (tab mode only): Terminal.svelte's `$activeFilePath` effect
 * reactively read `activePaneByTab` and scheduled
 * `requestAnimationFrame(() => focusPane(current))`. `focusPane` ALWAYS
 * reassigned `activePaneByTab` to a brand-new object (even when the active
 * pane was unchanged), which re-triggered that same effect → a self-
 * sustaining rAF loop. In tab mode an in-flight loop callback held a STALE
 * pane id (the previously-active newest pane); when the user clicked the
 * original pane, that stale `focusPane(stalePane)` returned 'deferred'
 * (programmatic + not-already-active) and stole focus back to the newest
 * pane. The clicked pane therefore showed `active`/`aria-pressed=true` (state
 * updated) yet the cursor never landed in it. Panel mode short-circuits the
 * effect (`activeFilePath` is not a terminal path), so it never looped.
 *
 * THE FIX is two-fold and both halves are pinned here:
 *   (A) `untrack` the pane read in the `$activeFilePath` effect so it fires
 *       only when the routed terminal *tab* changes, never on *pane* changes.
 *   (B) `setActivePaneId` is idempotent — re-selecting the active pane returns
 *       the SAME object reference, so no reactive reader churns.
 */
import { describe, expect, it } from 'vitest';
import { planPaneFocus, setActivePaneId } from '../../../src/lib/modules/terminal/focusManager';

// ─── Invariant B: setActivePaneId is idempotent ────────────────────────────

describe('setActivePaneId', () => {
  it('returns the SAME reference when the active pane is unchanged', () => {
    const map = { 1: 20 };
    expect(setActivePaneId(map, 1, 20)).toBe(map);
  });

  it('returns a NEW reference (with the new value) when the pane changes', () => {
    const map = { 1: 20 };
    const next = setActivePaneId(map, 1, 10);
    expect(next).not.toBe(map);
    expect(next).toEqual({ 1: 10 });
    expect(map).toEqual({ 1: 20 }); // no mutation
  });

  it('sets a tab that had no active pane yet', () => {
    const map: Record<number, number | null> = {};
    const next = setActivePaneId(map, 1, 10);
    expect(next).not.toBe(map);
    expect(next[1]).toBe(10);
  });

  it('preserves other tabs untouched', () => {
    expect(setActivePaneId({ 1: 20, 2: 99 }, 1, 10)).toEqual({ 1: 10, 2: 99 });
  });
});

// ─── Faithful harness of the effect ⇄ focusPane interaction ─────────────────
//
// Uses the REAL `planPaneFocus` + `setActivePaneId`. A manual rAF queue makes
// non-termination observable. `effectTracksPane` toggles the one production
// difference the fix changes:
//   • false → PRODUCTION (fix A applied): the `$activeFilePath` effect reads
//     the pane UNTRACKED, so a `setActivePane` from `focusPane` does NOT
//     re-run it. Pane clicks are plain user focuses.
//   • true  → PRE-FIX: the effect tracked `activePaneByTab`, so every
//     `setActivePane` re-ran it and re-scheduled a programmatic focus.

const TAB = 1;

function createHarness({ effectTracksPane }: { effectTracksPane: boolean }) {
  let activePaneByTab: Record<number, number | null> = {};
  let activeTab: number | null = null;
  /** Pane whose xterm holds DOM keyboard focus. */
  let domFocused: number | null = null;

  let queue: Array<() => void> = [];
  let runs = 0;
  function raf(cb: () => void) { queue.push(cb); }
  function flushFrame() {
    const batch = queue;
    queue = [];
    for (const cb of batch) { runs++; cb(); }
  }
  /** Run frames until the queue drains; capped so a runaway loop is visible. */
  function settle(maxFrames = 60): boolean {
    for (let i = 0; i < maxFrames; i++) {
      if (queue.length === 0) return true;
      flushFrame();
    }
    return queue.length === 0;
  }

  // The `$activeFilePath` effect body (re-focus the routed tab's active pane).
  function runActiveFileEffect() {
    if (activeTab == null) return;
    const current = activePaneByTab[activeTab];
    if (current != null) raf(() => focusPane(current, 'programmatic'));
  }

  function setActivePane(tabId: number, paneId: number | null) {
    const next = setActivePaneId(activePaneByTab, tabId, paneId);
    if (next === activePaneByTab) return; // idempotent → no reactive churn
    activePaneByTab = next;
    if (effectTracksPane) runActiveFileEffect(); // pre-fix reactivity
  }

  function focusPane(id: number, reason: 'user' | 'programmatic') {
    const plan = planPaneFocus({
      activeTabId: activeTab,
      activePaneIdForTab: activePaneByTab[TAB],
      targetTabId: TAB,
      targetPaneId: id,
      reason,
    });
    setActivePane(TAB, id);
    activeTab = TAB;
    if (plan.focus === 'none') return;
    if (plan.focus === 'immediate') domFocused = id;
    else raf(() => { domFocused = id; });
  }

  return {
    /** pointerdown / focusin on a pane. */
    clickPane: (id: number) => focusPane(id, 'user'),
    /** Switch the routed terminal tab (top-bar tab click) → fires the effect. */
    routeToTab: () => runActiveFileEffect(),
    settle,
    get domFocused() { return domFocused; },
    get activePane() { return activePaneByTab[TAB]; },
  };
}

// ─── PRODUCTION behavior (fix A + B): focus converges ───────────────────────

describe('tab-mode split focus — production (untracked effect + idempotent state)', () => {
  it('after a split, the focus loop terminates (no perpetual rAF)', () => {
    const h = createHarness({ effectTracksPane: false });
    h.clickPane(10);
    h.clickPane(20); // split → newest pane active
    expect(h.settle()).toBe(true);
    expect(h.activePane).toBe(20);
    expect(h.domFocused).toBe(20);
  });

  it('clicking the ORIGINAL pane gives it focus and it KEEPS it', () => {
    const h = createHarness({ effectTracksPane: false });
    h.clickPane(10);
    h.clickPane(20); // newest active
    h.settle();

    h.clickPane(10); // user clicks original
    expect(h.settle()).toBe(true);
    expect(h.activePane).toBe(10);
    expect(h.domFocused).toBe(10); // not stolen back to 20
  });

  it('rapid alternating clicks always settle on the LAST clicked pane', () => {
    const h = createHarness({ effectTracksPane: false });
    h.clickPane(10);
    h.clickPane(20);
    h.settle();

    h.clickPane(10);
    h.clickPane(20);
    h.clickPane(10);
    expect(h.settle()).toBe(true);
    expect(h.domFocused).toBe(10);
  });

  it('routing into the terminal tab does not steal focus from the active pane', () => {
    const h = createHarness({ effectTracksPane: false });
    h.clickPane(10);
    h.clickPane(20);
    h.settle();
    h.clickPane(10); // original now active + focused
    h.settle();

    h.routeToTab(); // e.g. top-bar terminal tab re-selected
    expect(h.settle()).toBe(true);
    expect(h.domFocused).toBe(10);
  });
});

// ─── Why fix A (untrack) is REQUIRED: idempotency alone diverges ────────────

describe('tab-mode split focus — pre-fix reactivity (proves untrack is required)', () => {
  it('with the effect tracking the active pane, rapid alternation never settles', () => {
    // Demonstrates that idempotent state (fix B) ALONE is insufficient: when
    // the effect still re-runs on pane changes, user clicks during alternation
    // schedule stale programmatic focuses that keep flipping the active pane
    // and re-scheduling — the rAF queue never drains. `untrack` (fix A) is
    // what actually prevents these stale schedules.
    const h = createHarness({ effectTracksPane: true });
    h.clickPane(10);
    h.clickPane(20);
    h.clickPane(10);
    expect(h.settle()).toBe(false); // never converges
  });
});

// ─── planPaneFocus: the stale programmatic refocus is the theft path ────────

describe('planPaneFocus stale-refocus contract', () => {
  it('a programmatic focus of a NON-active pane is deferred (the theft path)', () => {
    expect(planPaneFocus({
      activeTabId: 1,
      activePaneIdForTab: 10, // user just activated 10
      targetTabId: 1,
      targetPaneId: 20,       // stale rAF still targets the old newest pane
      reason: 'programmatic',
    })).toEqual({ activeChanged: true, focus: 'deferred' });
  });

  it('a user click of an already-active pane still refocuses (DOM focus may have drifted)', () => {
    expect(planPaneFocus({
      activeTabId: 1,
      activePaneIdForTab: 10,
      targetTabId: 1,
      targetPaneId: 10,
      reason: 'user',
    })).toEqual({ activeChanged: false, focus: 'immediate' });
  });
});
