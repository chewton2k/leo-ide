<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { SearchAddon } from '@xterm/addon-search';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { SerializeAddon } from '@xterm/addon-serialize';
  import { open } from '@tauri-apps/plugin-shell';
  import {
    projectRoot, terminalFontSize, appearanceMode, showTerminal,
    activeFilePath, openFiles, uiZoom,
    terminalSessions, terminalTabs, activeTerminalTabId, activeTerminalCwd, pendingTerminalCwd,
    createTerminalSignal, killTerminalSignal, resetTerminalSignal,
    splitTerminalSignal, collapseTerminalSplitsSignal,
    terminalCdSignal,
    terminalSearchSignal,
    isTerminalPath, terminalPath, terminalTabIdFromPath, allocateTerminalTabId,
    terminalTabLabel,
    terminalMode,
    registerOscHandlers,
    registerAgentDetect, agentTerminalStatus,
    notify,
    confirmTerminalClose,
    buildDropText,
    quotePathForShell,
    RendererPool, terminalRendererPoolEnabled,
    siblingLeaf,
    computeSplitLayout,
    setSplitRatio,
    type SplitNode,
    type SplitHandle,
    planPaneFocus,
    setActivePaneId,
    type PaneFocusReason,
    type TerminalTabInfo,
  } from '../../modules';
  import { get } from 'svelte/store';
  import { SplitSquareVertical, PanelBottom, Columns2 } from 'lucide-svelte';
  import '@xterm/xterm/css/xterm.css';

  // ── Types ────────────────────────────────────────────────────────

  interface TerminalPane {
    /** Backend PTY / session id. Also used as the DOM pane key. */
    id: number;
    sessionId: number;
    /** Which terminal tab this pane belongs to. */
    tabId: number;
    name: string;
    xterm: XTerm;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    webglAddon?: WebglAddon;
    serializeAddon: SerializeAddon;
    unlisten: UnlistenFn;
    unlistenExit: UnlistenFn;
    resizeObserver: ResizeObserver | null;
    mounted: boolean;
    oscDispose?: () => void;
    agentDispose?: () => void;
  }

  // ── State ────────────────────────────────────────────────────────

  let terminalRoot: HTMLDivElement;
  let dropActive = $state(false);
  // Set on teardown so the async `document.fonts.ready` handler doesn't touch
  // disposed xterm instances.
  let destroyed = false;
  // Caps live WebGL contexts when the renderer-pool flag is on (off = no-op).
  const webglPool = new RendererPool();
  let panes = $state<TerminalPane[]>([]);

  /** Per-tab split tree. Empty tabs have no entry. */
  let splitTrees = $state<Record<number, SplitNode | null>>({});
  /** Per-tab active pane id. Updated on click/focus/split/close. */
  let activePaneByTab = $state<Record<number, number | null>>({});

  let paneCwd = $state<Record<number, string>>({});

  let contextMenu = $state<{ x: number; y: number; paneId: number | null; tabId: number } | null>(null);

  // ── In-pane search (@xterm/addon-search) ──
  let searchVisible = $state(false);
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | undefined>();

  // ── Scrollback restore (@xterm/addon-serialize) ──
  function activePaneObj(): TerminalPane | null {
    return panes.find(p => p.id === currentActivePaneId) ?? null;
  }

  function openTerminalSearch() {
    searchVisible = true;
    requestAnimationFrame(() => searchInputEl?.select());
  }
  function runSearch(forward = true) {
    const p = activePaneObj();
    if (!p || !searchQuery) return;
    if (forward) p.searchAddon.findNext(searchQuery);
    else p.searchAddon.findPrevious(searchQuery);
  }
  function closeTerminalSearch() {
    searchVisible = false;
    searchQuery = '';
    activePaneObj()?.xterm.focus();
  }
  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(!e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); closeTerminalSearch(); }
  }

  // Command-palette trigger.
  $effect(() => {
    if ($terminalSearchSignal > 0) openTerminalSearch();
  });
  let contextMenuEl = $state<HTMLDivElement | undefined>();

  /** Serialize pane-mutation ops so rapid split/close clicks don't interleave. */
  let opChain = Promise.resolve();

  // ── Derived views for the active tab ─────────────────────────────

  const currentTabId = $derived($activeTerminalTabId);
  const currentPanes = $derived(
    currentTabId == null ? [] : panes.filter(p => p.tabId === currentTabId)
  );
  const currentSplitTree = $derived<SplitNode | null>(
    currentTabId == null ? null : (splitTrees[currentTabId] ?? null)
  );
  const currentActivePaneId = $derived<number | null>(
    currentTabId == null ? null : (activePaneByTab[currentTabId] ?? null)
  );

  /** Rect layout + divider handles for the ACTIVE tab's panes (the only ones
   *  that matter for layout — other tabs are CSS-hidden so their xterm stays
   *  alive). */
  const paneLayout = $derived(computeSplitLayout(currentSplitTree));
  const paneRects = $derived(paneLayout.rects);

  // ── Split tree helpers (pure functions) ──────────────────────────

  function findLeaf(node: SplitNode | null, paneId: number): boolean {
    if (!node) return false;
    if (node.type === 'leaf') return node.paneId === paneId;
    return findLeaf(node.children[0], paneId) || findLeaf(node.children[1], paneId);
  }

  function replaceLeaf(node: SplitNode, targetId: number, replacement: SplitNode): SplitNode {
    if (node.type === 'leaf') return node.paneId === targetId ? replacement : node;
    return {
      ...node,
      children: [
        replaceLeaf(node.children[0], targetId, replacement),
        replaceLeaf(node.children[1], targetId, replacement),
      ],
    };
  }

  function removeLeaf(node: SplitNode | null, paneId: number): SplitNode | null {
    if (!node) return null;
    if (node.type === 'leaf') return node.paneId === paneId ? null : node;
    const left = removeLeaf(node.children[0], paneId);
    const right = removeLeaf(node.children[1], paneId);
    if (!left && !right) return null;
    if (!left) return right;
    if (!right) return left;
    return { ...node, children: [left, right] };
  }

  /** Monotonic id for split nodes so divider drags can target a split. */
  let splitSeq = 0;
  function nextSplitId(): number {
    return ++splitSeq;
  }

  // ── Divider drag-to-resize ─────────────────────────
  // The split's `ratio` is updated live as the user drags the divider; panes
  // re-fit (rows/cols) on a rAF during the drag and once more on release.
  let resizeHandleId = $state<number | null>(null);
  let resizeRaf: number | null = null;

  function startResize(e: PointerEvent, h: SplitHandle) {
    if (currentTabId == null) return;
    e.preventDefault();
    e.stopPropagation();
    const tabId = currentTabId;
    resizeHandleId = h.id;
    const handleEl = e.currentTarget as HTMLElement;
    try { handleEl.setPointerCapture(e.pointerId); } catch { /* unsupported */ }

    const onMove = (ev: PointerEvent) => {
      const root = terminalRoot?.getBoundingClientRect();
      if (!root || root.width < 1 || root.height < 1) return;
      const xPct = ((ev.clientX - root.left) / root.width) * 100;
      const yPct = ((ev.clientY - root.top) / root.height) * 100;
      // Position within this split's own region → ratio for its first child.
      const ratio = h.direction === 'horizontal'
        ? (xPct - h.left) / h.width
        : (yPct - h.top) / h.height;
      const tree = splitTrees[tabId];
      if (!tree) return;
      setSplitTree(tabId, setSplitRatio(tree, h.id, ratio));
      if (resizeRaf == null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          for (const p of panes.filter(p => p.tabId === tabId)) fitPane(p);
        });
      }
    };

    const onUp = (ev: PointerEvent) => {
      resizeHandleId = null;
      try { handleEl.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (resizeRaf != null) { cancelAnimationFrame(resizeRaf); resizeRaf = null; }
      for (const p of panes.filter(p => p.tabId === tabId)) fitPane(p);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ── Per-tab state mutators ───────────────────────────────────────

  function setSplitTree(tabId: number, tree: SplitNode | null) {
    splitTrees = { ...splitTrees, [tabId]: tree };
  }
  function setActivePane(tabId: number, paneId: number | null) {
    // Idempotent: keep the SAME object reference when unchanged so the
    // `$activeFilePath` effect (which reads `activePaneByTab`) doesn't re-run
    // on no-op focus calls and spin up a self-sustaining focus rAF loop.
    activePaneByTab = setActivePaneId(activePaneByTab, tabId, paneId);
  }
  function removeTabState(tabId: number) {
    const { [tabId]: _tree, ...restTrees } = splitTrees;
    splitTrees = restTrees;
    const { [tabId]: _active, ...restActive } = activePaneByTab;
    activePaneByTab = restActive;
  }

  // ── Context-menu positioning ─────────────────────────────────────

  $effect(() => {
    if (contextMenuEl && contextMenu) {
      const rect = contextMenuEl.getBoundingClientRect();
      const viewH = window.innerHeight;
      const viewW = window.innerWidth;
      if (rect.bottom > viewH) {
        contextMenu.y = Math.max(4, contextMenu.y - (rect.bottom - viewH) - 8);
      }
      if (rect.right > viewW) {
        contextMenu.x = Math.max(4, contextMenu.x - (rect.right - viewW) - 8);
      }
    }
  });

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (currentTabId == null) return;
    const target = e.target as HTMLElement;
    const paneEl = target.closest('[data-pane-terminal]');
    const paneId = paneEl ? Number(paneEl.getAttribute('data-pane-terminal')) : currentActivePaneId;
    contextMenu = { x: e.clientX, y: e.clientY, paneId, tabId: currentTabId };
  }

  function closeContextMenu() { contextMenu = null; }

  function ctxAction(action: 'right' | 'bottom' | 'collapse' | 'close') {
    const paneId = contextMenu?.paneId;
    const tabId = contextMenu?.tabId ?? currentTabId;
    contextMenu = null;
    if (tabId == null) return;
    if (action === 'collapse') enqueue(() => collapseToActivePane(tabId));
    else if (action === 'close' && paneId != null) enqueue(async () => { if (await confirmTerminalClose(paneId)) await closePane(paneId); });
    else if (action === 'right' || action === 'bottom') {
      if (paneId != null) setActivePane(tabId, paneId);
      enqueue(() => splitTerminal(action, tabId));
    }
  }

  // ── xterm theme ──────────────────────────────────────────────────

  function buildXtermTheme() {
    const mode = get(appearanceMode);
    const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      return {
        background: '#131313', foreground: '#cccccc', cursor: '#7b9fc2', selectionBackground: '#2a3a4a',
        black: '#3b3b3b', red: '#f14c4c', green: '#4ec9b0', yellow: '#dcdcaa',
        blue: '#569cd6', magenta: '#c586c0', cyan: '#9cdcfe', white: '#cccccc',
        brightBlack: '#5a5a5a', brightRed: '#f14c4c', brightGreen: '#4ec9b0', brightYellow: '#dcdcaa',
        brightBlue: '#569cd6', brightMagenta: '#c586c0', brightCyan: '#9cdcfe', brightWhite: '#e0e0e0',
      };
    }
    return {
      background: '#fafafa', foreground: '#24292e', cursor: '#0969da', selectionBackground: '#d8dee4',
      black: '#8b949e', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
      blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#24292e',
      brightBlack: '#6e7781', brightRed: '#cf222e', brightGreen: '#1a7f37', brightYellow: '#9a6700',
      brightBlue: '#0969da', brightMagenta: '#8250df', brightCyan: '#1b7c83', brightWhite: '#24292e',
    };
  }

  // ── Pane helpers ─────────────────────────────────────────────────

  function getPaneMount(id: number): HTMLDivElement | null {
    return terminalRoot?.querySelector(`[data-pane-terminal="${id}"]`) ?? null;
  }

  /**
   * Route the editor's `activeFilePath` to a terminal sentinel so the
   * legacy in-tab terminal slot becomes the visible pane.
   *
   * In panel mode (`terminalMode === 'panel'`) the editor's focus is
   * independent of the docked terminal panel — the user keeps the same
   * file visible above the panel — so we skip the write. The panel
   * drives focus via `activeTerminalTabId` instead.
   */
  function routeActiveFileToTerminal(tabId: number) {
    if (get(terminalMode) === 'panel') return;
    activeFilePath.set(terminalPath(tabId));
  }

  /** The terminal
   *  is exempt from CSS zoom for correct selection, so it scales via xterm's
   *  native font size instead — which remeasures cells correctly. */
  function effectiveFontSize(base: number, zoom: number): number {
    return Math.max(4, Math.round(base * (zoom || 1)));
  }

  function fitPane(pane: TerminalPane) {
    if (!pane.mounted) return;
    const mount = getPaneMount(pane.id);
    if (!mount || mount.clientWidth < 10 || mount.clientHeight < 10) return;
    try { pane.fitAddon.fit(); } catch { /* Legitimate: xterm may not be attached to DOM yet */ }
  }

  /**
   * Force xterm to re-measure its character-cell size, then refit. xterm
   * measures the cell once on creation; if the terminal font (JetBrains Mono,
   * loaded async as a web font) wasn't ready yet, that measurement is taken
   * with a fallback font whose line-height differs — which makes mouse
   * selection map to the wrong rows (drifting further down the screen).
   * Toggling `fontFamily` re-triggers xterm's CharSizeService measurement.
   */
  function remeasurePane(pane: TerminalPane) {
    if (!pane.mounted) return;
    const fam = getComputedStyle(document.documentElement).getPropertyValue('--font-terminal').trim()
      || "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace";
    try {
      pane.xterm.options.fontFamily = `${fam}, monospace`;
      pane.xterm.options.fontFamily = fam;
    } catch { /* disposed */ }
    fitPane(pane);
  }

  function focusPane(id: number, reason: PaneFocusReason = 'programmatic') {
    const pane = panes.find((entry) => entry.id === id);
    if (!pane) return;
    const plan = planPaneFocus({
      activeTabId: get(activeTerminalTabId),
      activePaneIdForTab: activePaneByTab[pane.tabId],
      targetTabId: pane.tabId,
      targetPaneId: id,
      reason,
    });
    setActivePane(pane.tabId, id);
    // Focus also implies making that tab the active terminal tab.
    if (get(activeTerminalTabId) !== pane.tabId) {
      activeTerminalTabId.set(pane.tabId);
    }
    // Re-root the file tree to the newly-focused pane's cwd (per-pane state).
    if (paneCwd[id]) activeTerminalCwd.set(paneCwd[id]);
    if (plan.focus === 'none') return;
    const runFocus = () => {
      fitPane(pane);
      if (pane.mounted) {
        try { pane.xterm.focus(); } catch { /* Legitimate: terminal may not be visible */ }
      }
    };
    if (plan.focus === 'immediate') runFocus();
    else requestAnimationFrame(runFocus);
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = opChain.then(task);
    opChain = next.then(() => undefined, () => undefined);
    return next;
  }

  // ── Tab management ───────────────────────────────────────────────

  /** Create a brand-new terminal tab and seed it with a single pane. */
  async function createTab(): Promise<number | null> {
    const tabId = allocateTerminalTabId();
    terminalTabs.update(tabs => [...tabs, buildTabLabel(tabs, tabId)]);
    setSplitTree(tabId, null);
    setActivePane(tabId, null);
    activeTerminalTabId.set(tabId);
    showTerminal.set(true);
    routeActiveFileToTerminal(tabId);
    const pane = await createPane({ tabId });
    if (!pane) {
      // Backend refused to spawn — roll back the tab so the UI doesn't
      // show an empty placeholder tab forever.
      terminalTabs.update(tabs => tabs.filter(t => t.id !== tabId));
      removeTabState(tabId);
      if (get(activeTerminalTabId) === tabId) {
        const remaining = get(terminalTabs);
        activeTerminalTabId.set(remaining[0]?.id ?? null);
      }
      return null;
    }
    return tabId;
  }

  function buildTabLabel(existing: TerminalTabInfo[], id: number): TerminalTabInfo {
    // Use the next available sequential number (fills gaps left by closed tabs).
    const taken = new Set(existing.map(t => {
      const m = t.name.match(/^Terminal (\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    }));
    let n = 1;
    while (taken.has(n)) n++;
    return { id, name: `Terminal ${n}` };
  }

  async function focusTab(tabId: number) {
    activeTerminalTabId.set(tabId);
    showTerminal.set(true);
    routeActiveFileToTerminal(tabId);
    const activeInTab = activePaneByTab[tabId];
    if (activeInTab != null) {
      requestAnimationFrame(() => focusPane(activeInTab));
    } else {
      // Focus the first pane in this tab if any.
      const firstPane = panes.find(p => p.tabId === tabId);
      if (firstPane) {
        setActivePane(tabId, firstPane.id);
        requestAnimationFrame(() => focusPane(firstPane.id));
      }
    }
  }

  async function closeTab(tabId: number) {
    // Close all panes in this tab; the per-pane close handler handles the
    // tab removal when the last pane goes away.
    const tabPanes = panes.filter(p => p.tabId === tabId);
    for (const pane of tabPanes) {
      await closePane(pane.id);
    }
  }

  async function closeAllTabs() {
    for (const pane of [...panes]) {
      await closePane(pane.id);
    }
  }

  // ── Pane lifecycle ───────────────────────────────────────────────

  /**
   * Create a pane. Pass `tabId` to add to a specific tab, plus an optional
   * `splitFrom` pane + `direction` to split in-place.
   */
  async function createPane(target: {
    tabId: number;
    splitFrom?: number;
    direction?: 'horizontal' | 'vertical';
  }): Promise<TerminalPane | null> {
    // One-shot restore override: resume the terminal in its saved cwd, else
    // spawn at the project root. Consumed immediately so later panes don't
    // inherit it.
    const override = get(pendingTerminalCwd);
    if (override) pendingTerminalCwd.set(null);
    const cwd = override ?? get(projectRoot);
    const { tabId } = target;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: effectiveFontSize(get(terminalFontSize), get(uiZoom)),
      fontWeight: 500,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-terminal').trim()
        || "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace",
      theme: buildXtermTheme(),
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    xterm.loadAddon(searchAddon);
    const serializeAddon = new SerializeAddon();
    xterm.loadAddon(serializeAddon);
    xterm.loadAddon(new WebLinksAddon((_event, uri) => {
      if (uri.startsWith('http://') || uri.startsWith('https://')) open(uri);
    }));

    let sessionId: number;
    let name: string;
    let unlisten: UnlistenFn;
    let unlistenExit: UnlistenFn;

    try {
      const result = await invoke<{ id: number; pid: number | null }>('spawn_terminal', {
        cwd,
        rows: 24,
        cols: 80,
      });
      sessionId = result.id;
      name = result.pid ? `Terminal ${result.pid}` : `Terminal ${result.id}`;

      unlisten = await listen<string>(`terminal-output-${sessionId}`, (event) => {
        xterm.write(event.payload);
      });

      unlistenExit = await listen<void>(`terminal-exit-${sessionId}`, () => {
        enqueue(() => closePane(sessionId, false));
      });

      xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== 'keydown') return true;

        // App-level shortcuts (tab navigation, panel toggles, file
        // search, settings, etc.) are intercepted upstream by a
        // capture-phase listener on `window` in App.svelte
        // (`handleKeydownCapture`). That listener fires before this
        // handler, calls preventDefault + stopImmediatePropagation,
        // and dispatches the action — so by the time we get here the
        // event is guaranteed to NOT be an app shortcut. We therefore
        // only deal with terminal-specific keystrokes that map to PTY
        // control codes. Returning false means xterm doesn't process
        // the key; we've already dispatched the equivalent control
        // sequence ourselves via `write_terminal`.
        if (e.metaKey && e.key === 'Backspace') { invoke('write_terminal', { id: sessionId, data: '\x15' }); return false; }
        if (e.metaKey && e.key === 'ArrowLeft') { invoke('write_terminal', { id: sessionId, data: '\x01' }); return false; }
        if (e.metaKey && e.key === 'ArrowRight') { invoke('write_terminal', { id: sessionId, data: '\x05' }); return false; }
        if (e.altKey && e.key === 'Backspace') { invoke('write_terminal', { id: sessionId, data: '\x17' }); return false; }
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) { openTerminalSearch(); return false; }
        return true;
      });

      xterm.onData((data) => { invoke('write_terminal', { id: sessionId, data }); });
      xterm.onResize(({ rows, cols }) => { invoke('resize_terminal', { id: sessionId, rows, cols }); });
    } catch (e) {
      xterm.writeln(`\r\nFailed to start terminal: ${e}`);
      xterm.writeln('Terminal requires Tauri runtime.');
      xterm.dispose();
      return null;
    }

    const pane: TerminalPane = {
      id: sessionId,
      sessionId,
      tabId,
      name,
      xterm,
      fitAddon,
      searchAddon,
      serializeAddon,
      unlisten,
      unlistenExit,
      resizeObserver: null,
      mounted: false,
    };

    panes = [...panes, pane];
    // Seed with the spawn dir so focusing this pane re-roots the explorer
    // immediately, even before the shell's first OSC 7 cwd report arrives.
    if (cwd) paneCwd = { ...paneCwd, [sessionId]: cwd };
    pane.oscDispose = registerOscHandlers(xterm, (reported) => {
      paneCwd = { ...paneCwd, [pane.id]: reported };
      if (get(activeTerminalTabId) === pane.tabId && activePaneByTab[pane.tabId] === pane.id) {
        activeTerminalCwd.set(reported);
      }
    });
    pane.agentDispose = registerAgentDetect(xterm, (sig) => {
      if (sig === 'finished') {
        agentTerminalStatus.set('finished');
        if (typeof document !== 'undefined' && !document.hasFocus()) void notify('Agent finished');
      } else if (sig === 'attention') {
        agentTerminalStatus.set('attention');
      } else {
        agentTerminalStatus.set('working');
      }
    });

    // Listeners + OSC handler are now attached — tell the backend to start
    // streaming. Deferring until here means the shell's startup output (incl.
    // its first OSC 7 cwd report) can't be dropped by a spawn/listen race, so
    // the explorer follows this terminal's cwd without needing a command first.
    invoke('terminal_ready', { id: sessionId }).catch(() => { /* session may have been killed */ });

    // Update the split tree for this tab.
    const currentTree = splitTrees[tabId] ?? null;
    if (target.splitFrom && currentTree && findLeaf(currentTree, target.splitFrom) && target.direction) {
      setSplitTree(tabId, replaceLeaf(currentTree, target.splitFrom, {
        type: 'split',
        id: nextSplitId(),
        ratio: 0.5,
        direction: target.direction,
        children: [
          { type: 'leaf', paneId: target.splitFrom },
          { type: 'leaf', paneId: sessionId },
        ],
      }));
    } else if (!currentTree) {
      setSplitTree(tabId, { type: 'leaf', paneId: sessionId });
    }

    showTerminal.set(true);
    if (get(activeTerminalTabId) !== tabId) activeTerminalTabId.set(tabId);
    if (!isTerminalPath(get(activeFilePath)) || terminalTabIdFromPath(get(activeFilePath)) !== tabId) {
      routeActiveFileToTerminal(tabId);
    }

    // Wait for Svelte to render the mount div for this new pane.
    await tick();
    await new Promise((r) => requestAnimationFrame(r));

    const mount = getPaneMount(sessionId);
    if (mount) {
      xterm.open(mount);
      pane.mounted = true;
      // GPU renderer is opt-in and pooled: creating an uncapped WebGL
      // context per pane makes the OS drop the OLDEST context when you
      // split (esp. WKWebView on macOS), freezing the original pane. With
      // the pool off we stay on xterm's default renderer (robust, no
      // context limit). With the pool on, contexts are capped + evicted.
      try {
        if (get(terminalRendererPoolEnabled)) {
          const evicted = webglPool.acquire(pane.id);
          if (evicted !== null) {
            const ev = panes.find(p => p.id === evicted);
            if (ev?.webglAddon) { ev.webglAddon.dispose(); ev.webglAddon = undefined; }
          }
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => { webgl.dispose(); pane.webglAddon = undefined; webglPool.release(pane.id); });
          xterm.loadAddon(webgl);
          pane.webglAddon = webgl;
        }
      } catch { /* stay on DOM renderer */ }
      // Restore prior-session scrollback into the first terminal opened.
      fitPane(pane);
      await new Promise((r) => requestAnimationFrame(r));
      fitPane(pane);

      // If this pane opened before the terminal web font (JetBrains Mono)
      // finished loading, xterm measured the char cell against a fallback,
      // which offsets mouse selection. Re-measure once fonts are ready.
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(() => { if (!destroyed && pane.mounted) remeasurePane(pane); });
      }

      // Skip fits for panes whose tab is not currently active. Every
      // tab-layer is positioned `inset:0` so all panes' mount divs
      // resize together when the terminal container resizes — without
      // this guard, opening 5+ tabs would fire dozens of expensive
      // fit() calls on every window/panel resize. Inactive tabs are
      // re-fit by the `paneRects` $effect when they become active, so
      // skipping here is safe and the user never sees a stale layout.
      const resizeObserver = new ResizeObserver(() => {
        if (pane.tabId !== get(activeTerminalTabId)) return;
        fitPane(pane);
      });
      resizeObserver.observe(mount);
      pane.resizeObserver = resizeObserver;
    }

    setActivePane(tabId, sessionId);
    requestAnimationFrame(() => {
      if (pane.mounted) {
        try { pane.xterm.focus(); } catch { /* Legitimate: terminal may not be visible */ }
      }
    });

    return pane;
  }

  async function closePane(paneId: number, killBackend = true) {
    const idx = panes.findIndex((entry) => entry.id === paneId);
    if (idx === -1) return;

    const pane = panes[idx];
    const tabId = pane.tabId;

    pane.unlisten();
    pane.unlistenExit();
    pane.resizeObserver?.disconnect();
    pane.oscDispose?.();
    pane.agentDispose?.();
    agentTerminalStatus.set(null);
    webglPool.release(pane.id);
    pane.xterm.dispose();

    if (killBackend) {
      try { await invoke('kill_terminal', { id: pane.sessionId }); } catch { /* Legitimate: session may already be dead */ }
    }

    const remaining = panes.filter((entry) => entry.id !== paneId);
    panes = remaining;
    const { [paneId]: _droppedCwd, ...restCwd } = paneCwd;
    paneCwd = restCwd;

    const prevTree = splitTrees[tabId] ?? null;
    const newTree = removeLeaf(splitTrees[tabId] ?? null, paneId);
    setSplitTree(tabId, newTree);

    const tabPanes = remaining.filter(p => p.tabId === tabId);
    if (tabPanes.length === 0) {
      // Tab is now empty — remove it entirely.
      removeTabState(tabId);
      terminalTabs.update(tabs => tabs.filter(t => t.id !== tabId));
      if (remaining.length === 0) {
        showTerminal.set(false);
        if (isTerminalPath(get(activeFilePath))) {
          const files = get(openFiles);
          activeFilePath.set(files.at(-1)?.path ?? null);
        }
        activeTerminalTabId.set(null);
      } else {
        // Switch to another tab.
        const remainingTabs = get(terminalTabs);
        const nextTabId = remainingTabs[0]?.id ?? null;
        activeTerminalTabId.set(nextTabId);
        if (nextTabId != null && isTerminalPath(get(activeFilePath))) {
          activeFilePath.set(terminalPath(nextTabId));
        }
      }
    } else {
      // Other panes remain in this tab — pick a new active pane.
      const prevActive = activePaneByTab[tabId];
      if (prevActive === paneId) {
        const sibling = siblingLeaf(prevTree, paneId);
        const next = sibling != null && tabPanes.some(p => p.id === sibling) ? sibling : tabPanes[0].id;
        setActivePane(tabId, next);
      }
      // Refit remaining panes after layout change. Double-rAF ensures
      // the browser has completed the layout pass with the new pane
      // dimensions (the split tree collapsed, so the remaining pane
      // should now span the full area).
      await tick();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      for (const p of tabPanes) fitPane(p);
      const current = activePaneByTab[tabId];
      if (current != null) focusPane(current);
    }
  }

  // ── Split / collapse (within a tab) ──────────────────────────────

  async function splitTerminal(direction: 'right' | 'bottom', tabId: number) {
    const tabPanes = panes.filter(p => p.tabId === tabId);
    if (tabPanes.length === 0) {
      // Creating a split in an empty tab just spawns a pane.
      await createPane({ tabId });
      return;
    }
    const targetId = activePaneByTab[tabId] ?? tabPanes[0]?.id;
    if (targetId == null) return;
    const dir = direction === 'right' ? 'horizontal' : 'vertical';
    await createPane({ tabId, splitFrom: targetId, direction: dir });

    await tick();
    await new Promise((r) => requestAnimationFrame(r));
    for (const p of tabPanes) fitPane(p);
  }

  async function collapseToActivePane(tabId: number) {
    const tabPanes = panes.filter(p => p.tabId === tabId);
    const keepId = activePaneByTab[tabId] ?? tabPanes[0]?.id ?? null;
    if (keepId == null || tabPanes.length <= 1) return;
    for (const pane of tabPanes) {
      if (pane.id !== keepId) {
        await closePane(pane.id);
      }
    }
    focusPane(keepId);
  }

  // ── External signal handlers ─────────────────────────────────────

  // Mirror the panes list to the global `terminalSessions` store. This is
  // how the agent loop and other components see what terminals exist.
  $effect(() => {
    terminalSessions.set(panes.map(pane => ({
      id: pane.id,
      tabId: pane.tabId,
      name: pane.name,
    })));
  });

  // terminal in `…/projects/leo` shows as `leo` and re-labels as you `cd`.
  // Triggers on pane/cwd changes only; `terminalTabs` is read UNTRACKED so the
  // store write below can't re-trigger this effect (which would loop and throw
  // `effect_update_depth_exceeded`, freezing the whole UI).
  $effect(() => {
    activePaneByTab; paneCwd; // tracked deps
    const tabs = get(terminalTabs);
    let changed = false;
    const next = tabs.map(t => {
      const active = activePaneByTab[t.id];
      const cwd = active != null ? paneCwd[active] : undefined;
      const name = terminalTabLabel(cwd, t.name);
      if (name !== t.name) { changed = true; return { ...t, name }; }
      return t;
    });
    if (changed) terminalTabs.set(next);
  });

  // Keep `activeTerminalTabId` in sync with `activeFilePath` when the user
  // clicks a terminal tab in the top bar.
  $effect(() => {
    const path = $activeFilePath;
    if (!isTerminalPath(path)) return;
    const tabIdFromPath = terminalTabIdFromPath(path);
    if (tabIdFromPath != null && tabIdFromPath !== get(activeTerminalTabId)) {
      activeTerminalTabId.set(tabIdFromPath);
    }
    // Re-focus the active pane for this tab. Read `activePaneByTab` UNTRACKED:
    // this effect must fire only when the routed terminal *tab* changes, never
    // when the active *pane* mutates. Tracking the pane would make `focusPane`
    // → `setActivePane` re-trigger this effect, scheduling a fresh
    // `requestAnimationFrame(focusPane)` every run — a self-sustaining loop
    // whose stale captured pane id steals focus back to the newest pane in
    // tab mode (clicking the original split pane then never keeps the cursor).
    untrack(() => {
      const current = tabIdFromPath != null ? activePaneByTab[tabIdFromPath] : null;
      if (current != null) {
        requestAnimationFrame(() => focusPane(current));
      }
    });
  });

  // createTerminalSignal: create a new tab if requested, or ensure ≥1 tab exists.
  let createCount = 0;
  $effect(() => {
    const sig = $createTerminalSignal;
    if (sig.count <= createCount) return;
    createCount = sig.count;
    enqueue(async () => {
      if (sig.forceNew) {
        await createTab();
        return;
      }
      // Toggle/ensure behavior: if no tabs exist, create one; otherwise focus.
      const tabs = get(terminalTabs);
      if (tabs.length === 0) {
        await createTab();
      } else {
        const id = get(activeTerminalTabId) ?? tabs[0].id;
        focusTab(id);
      }
    });
  });

  let splitCount = 0;
  $effect(() => {
    const sig = $splitTerminalSignal;
    if (sig.count <= splitCount) return;
    splitCount = sig.count;
    enqueue(async () => {
      let tabId = get(activeTerminalTabId);
      if (tabId == null) {
        // No tab exists — create one + split immediately doesn't make sense,
        // so fall back to creating a single pane tab.
        await createTab();
        return;
      }
      await splitTerminal(sig.direction, tabId);
    });
  });

  let collapseCount = 0;
  $effect(() => {
    const sig = $collapseTerminalSplitsSignal;
    if (sig <= collapseCount) return;
    collapseCount = sig;
    const tabId = get(activeTerminalTabId);
    if (tabId == null) return;
    if (panes.filter(p => p.tabId === tabId).length > 1) {
      enqueue(async () => { await collapseToActivePane(tabId); });
    }
  });

  let cdCount = 0;
  $effect(() => {
    const sig = $terminalCdSignal;
    if (sig.count <= cdCount) return;
    cdCount = sig.count;
    if (!sig.path) return;
    const tabId = get(activeTerminalTabId);
    if (tabId == null) return;
    const paneId = activePaneByTab[tabId];
    const pane = panes.find(p => p.id === paneId) ?? panes.find(p => p.tabId === tabId);
    if (!pane) return;
    invoke('write_terminal', { id: pane.sessionId, data: `cd ${quotePathForShell(sig.path)}\r` }).catch(() => { /* PTY gone */ });
    focusPane(pane.id, 'user');
  });

  // killTerminalSignal: handle 'pane', 'tab', 'all' variants.
  $effect(() => {
    const target = $killTerminalSignal;
    if (target === null) return;
    killTerminalSignal.set(null);
    enqueue(async () => {
      if (target.kind === 'all') {
        await closeAllTabs();
      } else if (target.kind === 'tab') {
        await closeTab(target.id);
      } else {
        await closePane(target.id);
      }
    });
  });

  // Reset: close every terminal and spawn one fresh in the current project
  // root (createTab spawns at get(projectRoot)). Atomic so the close always
  // precedes the respawn (no effect-ordering race).
  let resetCount = 0;
  $effect(() => {
    const n = $resetTerminalSignal;
    if (n <= resetCount) return;
    resetCount = n;
    enqueue(async () => {
      await closeAllTabs();
      await createTab();
    });
  });

  // Apply the (zoom-scaled) terminal font size whenever the base size or UI
  // zoom changes. Setting xterm's fontSize remeasures cells correctly (unlike
  // CSS zoom), so selection stays accurate while the terminal scales with the
  // app zoom. Read `panes` untracked so this fires only on size/zoom changes.
  $effect(() => {
    const size = effectiveFontSize($terminalFontSize, $uiZoom);
    untrack(() => {
      for (const pane of panes) {
        pane.xterm.options.fontSize = size;
        fitPane(pane);
      }
    });
  });

  // Refit all panes when rects change (e.g. container resize or active tab switch).
  // Uses a double-rAF to ensure the browser has completed layout after the
  // DOM change that triggered the rect recomputation. A single rAF can fire
  // before the layout pass completes (especially after panel toggles that
  // change the terminal container's dimensions), causing fit() to read
  // zero/stale dimensions and blank the terminal.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    paneRects;
    currentTabId;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const p of currentPanes) fitPane(p);
      });
    });
  });

  // Auto-focus the active pane only when the terminal becomes visible
  // OR the user switches to a different terminal tab.
  //
  // Why we DON'T re-focus on every reactive ping:
  //   The previous version fired whenever `currentActivePaneId`,
  //   `$activeFilePath`, `$showTerminal`, or `$terminalMode` changed.
  //   In panel mode this meant any unrelated reactive update (e.g. the
  //   `panes` list mutating) would re-focus the active xterm, which
  //   stole focus from inputs elsewhere in the app — most visibly the
  //   file-tree create-folder input, whose `onblur` handler then
  //   canceled the in-progress folder creation. We track the previous
  //   visibility + tab so focus is only forced on actual transitions:
  //     • hidden → visible                  (panel opening, terminal-tab click)
  //     • active tab-id changes while shown (panel tab-strip click)
  //   All other cases (creating a new pane, clicking another pane,
  //   splitting) call `focusPane` directly, so no auto-focus needed.
  let lastTerminalVisible = false;
  let lastTabId: number | null = null;
  $effect(() => {
    const inTerminalTab = $terminalMode === 'tab' && isTerminalPath($activeFilePath);
    const panelShown = $terminalMode === 'panel';
    const visible = $showTerminal && (inTerminalTab || panelShown);
    const tabId = currentTabId;

    const visibilityTransitioned = visible && !lastTerminalVisible;
    const tabSwitched = visible && tabId !== null && tabId !== lastTabId;

    if ((visibilityTransitioned || tabSwitched) && currentActivePaneId !== null) {
      const paneId = currentActivePaneId;
      requestAnimationFrame(() => focusPane(paneId));
    }
    lastTerminalVisible = visible;
    lastTabId = tabId;
  });

  // ── Lifecycle ────────────────────────────────────────────────────

  onMount(() => {
    const unsubTheme = appearanceMode.subscribe(() => {
      const theme = buildXtermTheme();
      for (const pane of panes) {
        pane.xterm.options.theme = theme;
      }
    });

    // OS file-drop: insert quoted path(s) into the pane under the cursor.
    // Position-gated so it only acts over the terminal (FileTree handles
    // drops elsewhere). FileTree skips its import when the drop is over us.
    const paneAtPoint = (pos: { x: number; y: number }) => {
      const el = document.elementFromPoint(pos.x, pos.y)?.closest('[data-pane-terminal]');
      const id = el ? Number(el.getAttribute('data-pane-terminal')) : NaN;
      return Number.isNaN(id) ? null : panes.find(p => p.id === id) ?? null;
    };
    const dropUnlisteners: Array<() => void> = [];
    void (async () => {
      dropUnlisteners.push(await listen<{ position: { x: number; y: number } }>('tauri://drag-over', (e) => {
        dropActive = !!paneAtPoint(e.payload.position);
      }));
      dropUnlisteners.push(await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', async (e) => {
        dropActive = false;
        const pane = paneAtPoint(e.payload.position);
        if (!pane || !e.payload.paths?.length) return;
        try { await invoke('write_terminal', { id: pane.sessionId, data: buildDropText(e.payload.paths) + ' ' }); } catch { /* PTY gone */ }
      }));
      dropUnlisteners.push(await listen('tauri://drag-leave', () => { dropActive = false; }));
    })();

    return () => {
      unsubTheme();
      for (const u of dropUnlisteners) u();
    };
  });

  onDestroy(() => {
    destroyed = true;
    // Kill backend PTY processes immediately. Doing this here (rather
    // than via the async killTerminalSignal flow) avoids a race where
    // deferred close operations from this component fire AFTER a
    // fresh Terminal instance has been mounted and stomp on its
    // shared-store state (e.g. flipping showTerminal back to false
    // and hiding the user's new terminal).
    for (const pane of panes) {
      // Fire-and-forget: onDestroy can't await, but the backend kill
      // is independent of this component's lifecycle.
      invoke('kill_terminal', { id: pane.sessionId }).catch(() => { /* PTY may already be dead */ });
      pane.unlisten();
      pane.unlistenExit();
      pane.resizeObserver?.disconnect();
      pane.oscDispose?.();
      pane.agentDispose?.();
      webglPool.release(pane.id);
      pane.xterm.dispose();
    }
    terminalSessions.set([]);
    terminalTabs.set([]);
    activeTerminalTabId.set(null);
    createTerminalSignal.set({ count: 0, forceNew: false });
  });
</script>

<div class="terminal-panel">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="terminal-content" role="application" bind:this={terminalRoot} oncontextmenu={handleContextMenu}>
    {#if dropActive}
      <div class="term-drop-overlay">Drop to paste path</div>
    {/if}
    {#if searchVisible}
      <div class="term-search">
        <input
          bind:this={searchInputEl}
          bind:value={searchQuery}
          class="term-search-input"
          placeholder="Find in terminal…"
          spellcheck="false"
          oninput={() => runSearch(true)}
          onkeydown={onSearchKey}
        />
        <button class="term-search-btn" title="Previous (Shift+Enter)" onclick={() => runSearch(false)}>↑</button>
        <button class="term-search-btn" title="Next (Enter)" onclick={() => runSearch(true)}>↓</button>
        <button class="term-search-btn" title="Close (Esc)" onclick={closeTerminalSearch}>✕</button>
      </div>
    {/if}
    {#if $terminalTabs.length === 0}
      <div class="terminal-placeholder">Open a terminal to start a session.</div>
    {/if}

    <!--
      We render each terminal tab as its own absolutely-positioned layer.
      Inactive layers are CSS-hidden (visibility: hidden; pointer-events: none)
      so their xterm DOM stays mounted and the PTY output keeps writing into
      their scrollback — switching tabs is then instant with no loss of state.
    -->
    {#each $terminalTabs as tab (tab.id)}
      {@const tabPanes = panes.filter(p => p.tabId === tab.id)}
      {@const isActive = tab.id === currentTabId}
      {@const rectsForTab = isActive ? paneRects : computeSplitLayout(splitTrees[tab.id] ?? null).rects}
      <div class="tab-layer" class:active={isActive}>
        {#each tabPanes as pane (pane.id)}
          {@const rect = rectsForTab[pane.id]}
          {#if rect}
            <!--
              Why `onpointerdown` instead of `onclick` to update active state:
              xterm registers a `mousedown` listener on its element that
              calls `e.preventDefault()` and synchronously focuses its
              own helper textarea. `pointerdown` fires BEFORE `mousedown`
              for the same input event, so we update `activePaneByTab`
              before xterm processes its mouse handling — making the
              active-pane state always consistent with the focused xterm
              instance.

              `onfocusin` covers the cases pointerdown misses: keyboard
              tab-navigation into a pane, screen-reader-driven focus,
              and programmatic focus (e.g. xterm refocusing itself
              after a paste). focus events bubble as `focusin`, so a
              listener on the wrapper sees focus changes that happen
              anywhere inside the pane.
            -->
            <div
              class="terminal-pane"
              class:active={isActive && currentActivePaneId === pane.id}
              style="top:{rect.top}%;left:{rect.left}%;width:{rect.width}%;height:{rect.height}%"
              role="button"
              tabindex="0"
              aria-label="Terminal pane {pane.name}"
              aria-pressed={isActive && currentActivePaneId === pane.id}
              onpointerdowncapture={() => focusPane(pane.id, 'user')}
              onfocusin={() => focusPane(pane.id, 'user')}
              onkeydown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), focusPane(pane.id, 'user'))}
            >
              <div class="pane-body" data-pane-terminal={pane.id}></div>
            </div>
          {/if}
        {/each}
        {#if isActive}
          {#each paneLayout.handles as h (h.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="pane-resizer {h.direction}"
              class:dragging={resizeHandleId === h.id}
              style={h.direction === 'horizontal'
                ? `left:${h.pos}%;top:${h.top}%;height:${h.height}%;`
                : `top:${h.pos}%;left:${h.left}%;width:${h.width}%;`}
              role="separator"
              aria-orientation={h.direction === 'horizontal' ? 'vertical' : 'horizontal'}
              onpointerdown={(e) => startResize(e, h)}
            ></div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  {#if contextMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ctx-backdrop" role="presentation" onclick={closeContextMenu} onkeydown={(e) => e.key === 'Escape' && closeContextMenu()} oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}></div>
    <div class="ctx-menu" bind:this={contextMenuEl} style="left:{contextMenu.x}px;top:{contextMenu.y}px">
      <button class="ctx-item" onclick={() => ctxAction('right')}>
        <Columns2 size={13} /> Split Right
      </button>
      <button class="ctx-item" onclick={() => ctxAction('bottom')}>
        <PanelBottom size={13} /> Split Bottom
      </button>
      {#if contextMenu && panes.filter(p => p.tabId === contextMenu!.tabId).length > 1}
        <div class="ctx-divider"></div>
        <button class="ctx-item" onclick={() => ctxAction('close')}>
          Close Pane
        </button>
        <button class="ctx-item" onclick={() => ctxAction('collapse')}>
          <SplitSquareVertical size={13} /> Collapse Panes
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .terminal-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-tertiary);
    position: relative;
  }

  .terminal-content {
    flex: 1;
    min-height: 0;
    min-width: 0;
    position: relative;
    background: var(--border);
    overflow: hidden;
    zoom: calc(1 / var(--app-zoom, 1));
  }

  .term-drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 2px dashed var(--accent);
    pointer-events: none;
  }

  .term-search {
    position: absolute;
    top: 6px;
    right: 12px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  .term-search-input {
    width: 180px;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 12px;
    outline: none;
  }
  .term-search-input:focus { border-color: var(--settings-icon, #B34B3C); }
  .term-search-btn {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 5px;
    color: var(--text-muted); cursor: pointer; font-size: 12px;
  }
  .term-search-btn:hover { background: var(--bg-surface); color: var(--text-primary); }

  /* One absolutely-positioned layer per terminal tab. Only the active layer
     is visible — inactive layers keep their xterm DOM mounted so PTYs stay
     live and their scrollback isn't lost when switching.

     Uses opacity (not visibility) because the parent .terminal-tab-slot
     uses visibility:hidden to hide the terminal when a file tab is active.
     CSS spec allows a child to set visibility:visible and punch through a
     hidden parent — opacity on a child cannot override a parent's
     visibility:hidden. No transition is set so there's no blank frame. */
  .tab-layer {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
  }
  .tab-layer.active {
    opacity: 1;
    pointer-events: auto;
  }

  .terminal-pane {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-tertiary);
    box-sizing: border-box;
    border: 0.5px solid var(--border);
  }

  .terminal-pane:focus-visible {
    outline: none;
  }
  .pane-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 4px;
    overflow: hidden;
  }

  /* Draggable divider between split panes. Positioned on
     the split boundary; a thin visible line with a wider invisible hit area. */
  .pane-resizer {
    position: absolute;
    z-index: 15;
    background: transparent;
    touch-action: none;
  }
  .pane-resizer.horizontal {
    width: 8px;
    transform: translateX(-4px);
    cursor: col-resize;
  }
  .pane-resizer.vertical {
    height: 8px;
    transform: translateY(-4px);
    cursor: row-resize;
  }
  /* Center hairline that highlights on hover/drag. */
  .pane-resizer::before {
    content: '';
    position: absolute;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .pane-resizer.horizontal::before {
    top: 0; bottom: 0; left: 50%;
    width: 2px; transform: translateX(-1px);
  }
  .pane-resizer.vertical::before {
    left: 0; right: 0; top: 50%;
    height: 2px; transform: translateY(-1px);
  }
  .pane-resizer:hover::before,
  .pane-resizer.dragging::before { opacity: 0.6; }

  .pane-body :global(.xterm),
  .pane-body :global(.xterm-viewport),
  .pane-body :global(.xterm-screen) {
    height: 100%;
  }

  .terminal-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-muted);
    font-size: 13px;
  }

  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .ctx-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.1s;
  }

  .ctx-item:hover {
    background: var(--bg-surface);
  }

  .ctx-divider {
    height: 1px;
    background: var(--border);
    margin: 3px 6px;
  }
</style>
