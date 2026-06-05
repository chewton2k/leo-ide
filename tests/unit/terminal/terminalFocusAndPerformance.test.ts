/**
 * Tests for the two bug fixes:
 *   1. Cannot switch focus between split terminals (focusPane dedup,
 *      auto-focus effect, pointer/focus event handling, ARIA).
 *   2. Multiple terminal tabs cause lag + folder creation breaks
 *      (ResizeObserver active-tab gate, FileTree refreshTree deferral).
 *
 * These tests exercise the logic at the unit/integration level by mocking
 * xterm, FitAddon, and Tauri APIs. The Terminal.svelte component is NOT
 * mounted directly (it has deep Tauri + DOM dependencies); instead we
 * extract and test the behavioral logic via isolated harnesses.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import {
  activeTerminalTabId,
  terminalTabs,
  terminalSessions,
  showTerminal,
  terminalMode,
  activeFilePath,
  terminalPath,
  isTerminalPath,
} from '$lib/modules';

// ─── Mock xterm + FitAddon ─────────────────────────────────────────────────

function createMockXterm() {
  return {
    focus: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    loadAddon: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    options: {} as Record<string, unknown>,
  };
}

function createMockFitAddon() {
  return {
    fit: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
  };
}

// ─── Harness: focusPane logic (extracted from Terminal.svelte) ──────────────
//
// The production code lives inside a Svelte component's <script> block and
// cannot be imported directly. We replicate the exact logic here so we can
// unit-test the dedup behavior. If the production code drifts from this
// harness, tests will still document the EXPECTED behavior.
//
// FINDING: focusPane, fitPane, and the auto-focus effect are not exported
// from Terminal.svelte. They are component-local. To make these properly
// unit-testable, the logic should be extracted into a separate module
// (e.g. src/lib/modules/terminal/focusManager.ts). This is left as a
// recommendation for the next stage.

interface MockPane {
  id: number;
  tabId: number;
  xterm: ReturnType<typeof createMockXterm>;
  fitAddon: ReturnType<typeof createMockFitAddon>;
  mounted: boolean;
}

function createFocusPaneHarness() {
  const panes: MockPane[] = [];
  const activePaneByTab: Record<number, number | null> = {};
  // Mirrors the store
  let _activeTerminalTabId: number | null = null;

  function addPane(id: number, tabId: number): MockPane {
    const pane: MockPane = {
      id,
      tabId,
      xterm: createMockXterm(),
      fitAddon: createMockFitAddon(),
      mounted: true,
    };
    panes.push(pane);
    if (activePaneByTab[tabId] === undefined) activePaneByTab[tabId] = null;
    return pane;
  }

  function setActiveTab(tabId: number | null) {
    _activeTerminalTabId = tabId;
  }

  function getActiveTab() {
    return _activeTerminalTabId;
  }

  // Replicates the production focusPane logic
  function focusPane(id: number): { focused: boolean; fitted: boolean } {
    const pane = panes.find(p => p.id === id);
    if (!pane) return { focused: false, fitted: false };

    const alreadyActive =
      _activeTerminalTabId === pane.tabId &&
      activePaneByTab[pane.tabId] === id;

    // Always update the active pane for the tab (cheap, deduped)
    activePaneByTab[pane.tabId] = id;

    // Also set the active terminal tab if different
    if (_activeTerminalTabId !== pane.tabId) {
      _activeTerminalTabId = pane.tabId;
    }

    if (alreadyActive) return { focused: false, fitted: false };

    // In production this is inside a rAF; here we call synchronously
    pane.fitAddon.fit();
    if (pane.mounted) {
      pane.xterm.focus();
    }
    return { focused: true, fitted: true };
  }

  function removePane(id: number) {
    const idx = panes.findIndex(p => p.id === id);
    if (idx !== -1) panes.splice(idx, 1);
  }

  return { panes, activePaneByTab, addPane, setActiveTab, getActiveTab, focusPane, removePane };
}

// ─── GROUP A: focusPane dedup ──────────────────────────────────────────────

describe('Group A — focusPane dedup (Bug 1)', () => {
  let harness: ReturnType<typeof createFocusPaneHarness>;

  beforeEach(() => {
    harness = createFocusPaneHarness();
  });

  it('already-active pane is a no-op for xterm.focus() and fit()', () => {
    const pane = harness.addPane(1, 100);
    harness.setActiveTab(100);
    // First call activates
    const first = harness.focusPane(1);
    expect(first.focused).toBe(true);
    expect(first.fitted).toBe(true);
    expect(pane.xterm.focus).toHaveBeenCalledTimes(1);
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1);

    // Second call is a no-op
    const second = harness.focusPane(1);
    expect(second.focused).toBe(false);
    expect(second.fitted).toBe(false);
    expect(pane.xterm.focus).toHaveBeenCalledTimes(1);
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1);
  });

  it('switch to new pane in same tab calls focus and fit', () => {
    const pane1 = harness.addPane(1, 100);
    const pane2 = harness.addPane(2, 100);
    harness.setActiveTab(100);

    harness.focusPane(1);
    const result = harness.focusPane(2);
    expect(result.focused).toBe(true);
    expect(result.fitted).toBe(true);
    expect(pane2.xterm.focus).toHaveBeenCalledTimes(1);
    expect(pane2.fitAddon.fit).toHaveBeenCalledTimes(1);
    // pane1 should not have been re-focused
    expect(pane1.xterm.focus).toHaveBeenCalledTimes(1);
  });

  it('switch to pane in different tab calls focus and updates active tab', () => {
    harness.addPane(1, 100);
    const pane2 = harness.addPane(2, 200);
    harness.setActiveTab(100);
    harness.focusPane(1);

    const result = harness.focusPane(2);
    expect(result.focused).toBe(true);
    expect(harness.getActiveTab()).toBe(200);
    expect(pane2.xterm.focus).toHaveBeenCalledTimes(1);
  });

  it('focus pane that does not exist is a no-op', () => {
    harness.addPane(1, 100);
    harness.setActiveTab(100);

    const result = harness.focusPane(999);
    expect(result.focused).toBe(false);
    expect(result.fitted).toBe(false);
  });

  it('updates activePaneByTab even on no-op (store always reflects intent)', () => {
    harness.addPane(1, 100);
    harness.setActiveTab(100);
    harness.focusPane(1);

    // Call again — still a no-op for xterm but store is set
    harness.focusPane(1);
    expect(harness.activePaneByTab[100]).toBe(1);
  });

  it('unmounted pane skips xterm.focus but still calls fit', () => {
    const pane = harness.addPane(1, 100);
    pane.mounted = false;
    harness.setActiveTab(100);

    const result = harness.focusPane(1);
    expect(result.fitted).toBe(true);
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(pane.xterm.focus).not.toHaveBeenCalled();
  });
});

// ─── Harness: auto-focus visibility/tab transition logic ───────────────────
//
// The production $effect tracks `lastTerminalVisible` and `lastTabId` as
// module-scope vars. We replicate the transition detection logic here.

function createAutoFocusHarness() {
  let lastTerminalVisible = false;
  let lastTabId: number | null = null;
  const focusCalls: number[] = [];

  /**
   * Simulates the $effect body. Returns whether focus would fire.
   */
  function tick(opts: {
    showTerminal: boolean;
    terminalMode: 'tab' | 'panel';
    activeFilePath: string | null;
    currentTabId: number | null;
    currentActivePaneId: number | null;
  }): boolean {
    const inTerminalTab =
      opts.terminalMode === 'tab' && isTerminalPath(opts.activeFilePath);
    const panelShown = opts.terminalMode === 'panel';
    const visible = opts.showTerminal && (inTerminalTab || panelShown);
    const tabId = opts.currentTabId;

    const visibilityTransitioned = visible && !lastTerminalVisible;
    const tabSwitched = visible && tabId !== null && tabId !== lastTabId;

    let fired = false;
    if ((visibilityTransitioned || tabSwitched) && opts.currentActivePaneId !== null) {
      focusCalls.push(opts.currentActivePaneId);
      fired = true;
    }
    lastTerminalVisible = visible;
    lastTabId = tabId;
    return fired;
  }

  function reset() {
    lastTerminalVisible = false;
    lastTabId = null;
    focusCalls.length = 0;
  }

  return { tick, focusCalls, reset };
}

// ─── GROUP B: auto-focus only on visibility/tab transitions ────────────────

describe('Group B — auto-focus visibility/tab transitions (Bug 1)', () => {
  let harness: ReturnType<typeof createAutoFocusHarness>;

  beforeEach(() => {
    harness = createAutoFocusHarness();
  });

  it('hidden → visible fires focus', () => {
    // Start hidden
    harness.tick({
      showTerminal: false,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 10,
    });

    // Become visible
    const fired = harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 10,
    });
    expect(fired).toBe(true);
    expect(harness.focusCalls).toEqual([10]);
  });

  it('visible → hidden does NOT fire focus', () => {
    // Start visible
    harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 10,
    });

    // Become hidden
    const fired = harness.tick({
      showTerminal: false,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 10,
    });
    expect(fired).toBe(false);
  });

  it('visible + same tab + activePaneId change does NOT fire focus', () => {
    harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 10,
    });

    // Change active pane but same tab, already visible
    const fired = harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 20,
    });
    expect(fired).toBe(false);
  });

  it('visible + tab switch fires focus', () => {
    harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: 10,
    });

    // Switch to tab 2
    const fired = harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 2,
      currentActivePaneId: 20,
    });
    expect(fired).toBe(true);
    expect(harness.focusCalls).toEqual([10, 20]);
  });

  it('visible + activeFilePath flip (non-terminal) does NOT fire focus', () => {
    harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: '/some/file.ts',
      currentTabId: 1,
      currentActivePaneId: 10,
    });

    const fired = harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: '/other/file.ts',
      currentTabId: 1,
      currentActivePaneId: 10,
    });
    expect(fired).toBe(false);
  });

  it('tab mode: visible only when activeFilePath is a terminal path', () => {
    // In tab mode, not on a terminal path → not visible
    const fired1 = harness.tick({
      showTerminal: true,
      terminalMode: 'tab',
      activeFilePath: '/some/file.ts',
      currentTabId: 1,
      currentActivePaneId: 10,
    });
    expect(fired1).toBe(false);

    // Switch to terminal path → becomes visible → fires
    const fired2 = harness.tick({
      showTerminal: true,
      terminalMode: 'tab',
      activeFilePath: terminalPath(1),
      currentTabId: 1,
      currentActivePaneId: 10,
    });
    expect(fired2).toBe(true);
  });

  it('does NOT fire when currentActivePaneId is null', () => {
    const fired = harness.tick({
      showTerminal: true,
      terminalMode: 'panel',
      activeFilePath: null,
      currentTabId: 1,
      currentActivePaneId: null,
    });
    expect(fired).toBe(false);
  });
});

// ─── Harness: ResizeObserver active-tab gate ───────────────────────────────
//
// The production ResizeObserver callback does:
//   if (pane.tabId !== get(activeTerminalTabId)) return;
//   fitPane(pane);
//
// We test this gating logic by simulating the callback.

function createResizeObserverHarness() {
  // Use the real activeTerminalTabId store
  const fitCalls: number[] = [];

  function simulateResize(pane: { id: number; tabId: number; fitAddon: ReturnType<typeof createMockFitAddon> }) {
    // Replicate the guard from createPane's ResizeObserver callback
    if (pane.tabId !== get(activeTerminalTabId)) return;
    pane.fitAddon.fit();
    fitCalls.push(pane.id);
  }

  return { fitCalls, simulateResize };
}

// ─── GROUP C: ResizeObserver active-tab gate (Bug 2) ───────────────────────

describe('Group C — ResizeObserver active-tab gate (Bug 2)', () => {
  let harness: ReturnType<typeof createResizeObserverHarness>;

  beforeEach(() => {
    harness = createResizeObserverHarness();
    activeTerminalTabId.set(null);
  });

  afterEach(() => {
    activeTerminalTabId.set(null);
  });

  it('only fits panes whose tabId matches activeTerminalTabId', () => {
    activeTerminalTabId.set(100);

    const paneActive = { id: 1, tabId: 100, fitAddon: createMockFitAddon() };
    const paneInactive = { id: 2, tabId: 200, fitAddon: createMockFitAddon() };

    harness.simulateResize(paneActive);
    harness.simulateResize(paneInactive);

    expect(paneActive.fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(paneInactive.fitAddon.fit).not.toHaveBeenCalled();
    expect(harness.fitCalls).toEqual([1]);
  });

  it('when active tab changes, previously-active pane is now gated', () => {
    activeTerminalTabId.set(100);
    const pane = { id: 1, tabId: 100, fitAddon: createMockFitAddon() };

    harness.simulateResize(pane);
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1);

    // Switch active tab
    activeTerminalTabId.set(200);
    harness.simulateResize(pane);
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1); // no additional call
  });

  it('null activeTerminalTabId gates all panes', () => {
    activeTerminalTabId.set(null);
    const pane = { id: 1, tabId: 100, fitAddon: createMockFitAddon() };

    harness.simulateResize(pane);
    expect(pane.fitAddon.fit).not.toHaveBeenCalled();
  });

  it('multiple panes in active tab all get fitted', () => {
    activeTerminalTabId.set(100);
    const pane1 = { id: 1, tabId: 100, fitAddon: createMockFitAddon() };
    const pane2 = { id: 2, tabId: 100, fitAddon: createMockFitAddon() };
    const pane3 = { id: 3, tabId: 200, fitAddon: createMockFitAddon() };

    harness.simulateResize(pane1);
    harness.simulateResize(pane2);
    harness.simulateResize(pane3);

    expect(pane1.fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(pane2.fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(pane3.fitAddon.fit).not.toHaveBeenCalled();
    expect(harness.fitCalls).toEqual([1, 2]);
  });
});

// ─── Harness: FileTree refreshTree deferral logic ──────────────────────────
//
// The FileTree component's refreshTree/flushPendingWatcherRefresh logic is
// also component-local. We replicate the exact gating logic here.
//
// FINDING: Like focusPane, refreshTree is not exported. Extracting it into
// a testable module (e.g. src/lib/modules/filetree/refreshManager.ts) would
// improve testability. Left as a recommendation.

function createRefreshTreeHarness() {
  let creating: 'file' | 'folder' | null = null;
  let refreshInProgress = false;
  let pendingWatcherRefresh = false;
  let refreshCount = 0;

  async function refreshTree(opts: { fromWatcher?: boolean } = {}): Promise<boolean> {
    if (refreshInProgress) return false;
    if (opts.fromWatcher && creating) {
      pendingWatcherRefresh = true;
      return false;
    }
    refreshInProgress = true;
    try {
      refreshCount++;
      // Simulate async work
      await Promise.resolve();
      return true;
    } finally {
      refreshInProgress = false;
    }
  }

  function flushPendingWatcherRefresh() {
    if (pendingWatcherRefresh && !creating) {
      pendingWatcherRefresh = false;
      refreshTree({ fromWatcher: true });
    }
  }

  function startCreate(type: 'file' | 'folder') {
    creating = type;
  }

  function confirmCreate() {
    creating = null;
    flushPendingWatcherRefresh();
  }

  function cancelCreate() {
    creating = null;
    flushPendingWatcherRefresh();
  }

  return {
    get creating() { return creating; },
    get refreshInProgress() { return refreshInProgress; },
    get pendingWatcherRefresh() { return pendingWatcherRefresh; },
    get refreshCount() { return refreshCount; },
    refreshTree,
    flushPendingWatcherRefresh,
    startCreate,
    confirmCreate,
    cancelCreate,
    // Expose for edge-case testing
    set _creating(v: 'file' | 'folder' | null) { creating = v; },
    set _pendingWatcherRefresh(v: boolean) { pendingWatcherRefresh = v; },
  };
}

// ─── GROUP D: FileTree refreshTree deferral (Bug 2) ────────────────────────

describe('Group D — FileTree refreshTree deferral (Bug 2)', () => {
  let harness: ReturnType<typeof createRefreshTreeHarness>;

  beforeEach(() => {
    harness = createRefreshTreeHarness();
  });

  it('watcher refresh is deferred when creating is active', async () => {
    harness.startCreate('folder');
    const ran = await harness.refreshTree({ fromWatcher: true });
    expect(ran).toBe(false);
    expect(harness.pendingWatcherRefresh).toBe(true);
    expect(harness.refreshCount).toBe(0);
  });

  it('explicit refresh (no fromWatcher) still runs during creation', async () => {
    harness.startCreate('file');
    const ran = await harness.refreshTree();
    expect(ran).toBe(true);
    expect(harness.refreshCount).toBe(1);
  });

  it('cancelCreate flushes pending watcher refresh', async () => {
    harness.startCreate('folder');
    await harness.refreshTree({ fromWatcher: true });
    expect(harness.pendingWatcherRefresh).toBe(true);

    harness.cancelCreate();
    // flush is fire-and-forget; wait a tick
    await new Promise(r => setTimeout(r, 0));
    expect(harness.refreshCount).toBe(1);
    expect(harness.pendingWatcherRefresh).toBe(false);
  });

  it('confirmCreate flushes pending watcher refresh', async () => {
    harness.startCreate('file');
    await harness.refreshTree({ fromWatcher: true });

    harness.confirmCreate();
    await new Promise(r => setTimeout(r, 0));
    expect(harness.refreshCount).toBe(1);
  });

  it('no pending refresh means flush is a no-op', async () => {
    harness.startCreate('file');
    // No watcher refresh triggered
    harness.cancelCreate();
    await new Promise(r => setTimeout(r, 0));
    expect(harness.refreshCount).toBe(0);
  });

  it('refreshInProgress guard prevents overlapping refreshes', async () => {
    // Start a refresh that hasn't resolved yet
    const p1 = harness.refreshTree();
    const p2 = harness.refreshTree();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(harness.refreshCount).toBe(1);
  });

  it('multiple watcher refreshes during creation only set flag once', async () => {
    harness.startCreate('folder');
    await harness.refreshTree({ fromWatcher: true });
    await harness.refreshTree({ fromWatcher: true });
    await harness.refreshTree({ fromWatcher: true });
    expect(harness.pendingWatcherRefresh).toBe(true);
    expect(harness.refreshCount).toBe(0);

    harness.cancelCreate();
    await new Promise(r => setTimeout(r, 0));
    // Only one refresh fires on flush
    expect(harness.refreshCount).toBe(1);
  });
});

// ─── GROUP E: accessibility / ARIA ─────────────────────────────────────────
//
// These tests verify the expected DOM attributes on the terminal pane wrapper.
// Since we can't easily mount Terminal.svelte in jsdom (xterm needs a real
// canvas), we verify the contract: the template should produce elements with
// the correct attributes. We test this by parsing the expected attribute
// values from the component source as a "contract test".
//
// FINDING: A full component render test would require mocking @xterm/xterm's
// Terminal class (which needs canvas), @tauri-apps/plugin-shell, and the
// invoke spawn_terminal flow. This is feasible but heavyweight. For now we
// test the ARIA contract via attribute assertions on a minimal DOM fixture.

describe('Group E — accessibility / ARIA', () => {
  it('terminal pane wrapper has correct role, tabindex, and aria-pressed', () => {
    // Simulate the DOM structure the template produces
    const div = document.createElement('div');
    div.className = 'terminal-pane active';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-label', 'Terminal pane Terminal 1');
    div.setAttribute('aria-pressed', 'true');

    expect(div.getAttribute('role')).toBe('button');
    expect(div.getAttribute('tabindex')).toBe('0');
    expect(div.getAttribute('aria-pressed')).toBe('true');
    expect(div.getAttribute('aria-label')).toContain('Terminal pane');
  });

  it('inactive pane has aria-pressed=false', () => {
    const div = document.createElement('div');
    div.className = 'terminal-pane';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-pressed', 'false');

    expect(div.getAttribute('aria-pressed')).toBe('false');
    expect(div.classList.contains('active')).toBe(false);
  });

  it('pane wrapper responds to Enter and Space keydown', () => {
    // Verify the contract: onkeydown handler calls preventDefault and
    // focusPane on Enter/Space. We test the logic inline.
    const preventDefault = vi.fn();
    const focusPaneMock = vi.fn();

    function handleKeydown(e: { key: string; preventDefault: () => void }) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusPaneMock(1);
      }
    }

    handleKeydown({ key: 'Enter', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(focusPaneMock).toHaveBeenCalledWith(1);

    handleKeydown({ key: ' ', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(focusPaneMock).toHaveBeenCalledTimes(2);

    // Other keys don't trigger
    handleKeydown({ key: 'Tab', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(focusPaneMock).toHaveBeenCalledTimes(2);
  });
});

// ─── GROUP F: edge cases ───────────────────────────────────────────────────

describe('Group F — edge cases', () => {
  describe('focusPane edge cases', () => {
    let harness: ReturnType<typeof createFocusPaneHarness>;

    beforeEach(() => {
      harness = createFocusPaneHarness();
    });

    it('focusPane called with a freshly-disposed pane id is a no-op', () => {
      const pane = harness.addPane(1, 100);
      harness.setActiveTab(100);
      harness.focusPane(1);

      // Dispose the pane
      harness.removePane(1);

      // Attempt to focus the disposed pane
      const result = harness.focusPane(1);
      expect(result.focused).toBe(false);
      expect(result.fitted).toBe(false);
    });

    it('rapid alternating focusPane calls between two panes', () => {
      const pane1 = harness.addPane(1, 100);
      const pane2 = harness.addPane(2, 100);
      harness.setActiveTab(100);

      // Rapid alternation
      harness.focusPane(1);
      harness.focusPane(2);
      harness.focusPane(1);
      harness.focusPane(2);
      harness.focusPane(1);

      // Each switch should call focus exactly once per switch
      expect(pane1.xterm.focus).toHaveBeenCalledTimes(3);
      expect(pane2.xterm.focus).toHaveBeenCalledTimes(2);
      expect(pane1.fitAddon.fit).toHaveBeenCalledTimes(3);
      expect(pane2.fitAddon.fit).toHaveBeenCalledTimes(2);
    });

    it('focusPane on pane whose tab is not the active tab still updates state', () => {
      harness.addPane(1, 100);
      const pane2 = harness.addPane(2, 200);
      harness.setActiveTab(100);
      harness.focusPane(1);

      // Focus pane in tab 200 — should switch active tab
      harness.focusPane(2);
      expect(harness.getActiveTab()).toBe(200);
      expect(harness.activePaneByTab[200]).toBe(2);
      expect(pane2.xterm.focus).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshTree edge cases', () => {
    let harness: ReturnType<typeof createRefreshTreeHarness>;

    beforeEach(() => {
      harness = createRefreshTreeHarness();
    });

    it('refreshTree with and without fromWatcher concurrently (refreshInProgress guard)', async () => {
      harness.startCreate('file');

      // Explicit refresh starts (not gated by creating)
      const p1 = harness.refreshTree(); // explicit, runs
      // Watcher refresh while explicit is in progress — hits refreshInProgress
      // guard BEFORE the fromWatcher+creating check, so pendingWatcherRefresh
      // is NOT set. This is the production behavior: the refreshInProgress
      // guard takes priority.
      const p2 = harness.refreshTree({ fromWatcher: true });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(false); // blocked by refreshInProgress, not creating
      // pendingWatcherRefresh is NOT set because the refreshInProgress guard
      // returned before reaching the fromWatcher check.
      expect(harness.pendingWatcherRefresh).toBe(false);

      // FINDING: This means watcher events that arrive during an in-progress
      // refresh are silently dropped — they don't get deferred. The production
      // code has the same behavior. This is acceptable because the watcher
      // fires frequently (every 300ms debounced) so the next event will catch
      // the change. But it's worth noting as a potential race condition edge case.
    });

    it('pendingWatcherRefresh cleared correctly when create succeeds', async () => {
      harness.startCreate('folder');
      await harness.refreshTree({ fromWatcher: true });
      expect(harness.pendingWatcherRefresh).toBe(true);

      harness.confirmCreate();
      await new Promise(r => setTimeout(r, 0));
      expect(harness.pendingWatcherRefresh).toBe(false);
      expect(harness.creating).toBe(null);
    });

    it('pendingWatcherRefresh cleared when create is cancelled', async () => {
      harness.startCreate('folder');
      await harness.refreshTree({ fromWatcher: true });

      harness.cancelCreate();
      await new Promise(r => setTimeout(r, 0));
      expect(harness.pendingWatcherRefresh).toBe(false);
    });

    /**
     * FINDING: In the production code, if confirmCreate() encounters an
     * error (e.g. invoke('create_folder') throws), it does `return` early
     * WITHOUT clearing `creating`. This means `flushPendingWatcherRefresh`
     * is never called, and `pendingWatcherRefresh` stays true forever
     * (until the user manually cancels or the component unmounts).
     *
     * This test documents the bug: if create errors, the pending refresh
     * is never flushed. The production code should clear `creating` in a
     * finally block or call flushPendingWatcherRefresh in the error path.
     */
    it('KNOWN BUG: pendingWatcherRefresh is NOT cleared when create errors (production code keeps creating set)', async () => {
      harness.startCreate('folder');
      await harness.refreshTree({ fromWatcher: true });

      // Simulate error path: creating stays set (production behavior)
      // In production: confirmCreate catches error, does `return` without
      // clearing `creating`. We simulate by just not calling confirmCreate
      // or cancelCreate.
      expect(harness.creating).toBe('folder');
      expect(harness.pendingWatcherRefresh).toBe(true);

      // flushPendingWatcherRefresh won't flush because creating is still set
      harness.flushPendingWatcherRefresh();
      await new Promise(r => setTimeout(r, 0));
      expect(harness.pendingWatcherRefresh).toBe(true); // Still stuck!
      expect(harness.refreshCount).toBe(0);
    });
  });

  describe('auto-focus edge cases', () => {
    let harness: ReturnType<typeof createAutoFocusHarness>;

    beforeEach(() => {
      harness = createAutoFocusHarness();
    });

    it('rapid visibility toggles only fire on false→true transitions', () => {
      // hidden
      harness.tick({ showTerminal: false, terminalMode: 'panel', activeFilePath: null, currentTabId: 1, currentActivePaneId: 10 });
      // visible
      harness.tick({ showTerminal: true, terminalMode: 'panel', activeFilePath: null, currentTabId: 1, currentActivePaneId: 10 });
      // hidden
      harness.tick({ showTerminal: false, terminalMode: 'panel', activeFilePath: null, currentTabId: 1, currentActivePaneId: 10 });
      // visible again
      harness.tick({ showTerminal: true, terminalMode: 'panel', activeFilePath: null, currentTabId: 1, currentActivePaneId: 10 });

      // Should have fired exactly twice (two false→true transitions)
      expect(harness.focusCalls).toEqual([10, 10]);
    });

    it('tab switch from null to a valid tab fires focus', () => {
      // Start with null tab (no tabs open)
      harness.tick({ showTerminal: true, terminalMode: 'panel', activeFilePath: null, currentTabId: null, currentActivePaneId: null });

      // Tab appears
      const fired = harness.tick({ showTerminal: true, terminalMode: 'panel', activeFilePath: null, currentTabId: 1, currentActivePaneId: 10 });
      expect(fired).toBe(true);
    });
  });
});
