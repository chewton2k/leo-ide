<script lang="ts">
  import FileTree from './lib/components/filetree/FileTree.svelte';
  import { Sparkles, TerminalSquare, Search } from 'lucide-svelte';
  import Editor from './lib/components/editor/Editor.svelte';
  import FileViewer from './lib/components/file-viewer/FileViewer.svelte';
  import JSONViewer from './lib/components/file-viewer/JSONViewer.svelte';
  import MergeEditor from './lib/components/merge/MergeEditor.svelte';
  import DiffViewer from './lib/components/diff/DiffViewer.svelte';
  import Toolbar from './lib/components/toolbar/Toolbar.svelte';
  import TitleBar from './lib/components/toolbar/TitleBar.svelte';
  import Terminal from './lib/components/shell/Terminal.svelte';
  import TerminalPanel from './lib/components/shell/TerminalPanel.svelte';
  import FloatingChat from './lib/components/ai/FloatingChat.svelte';
  import GitPanel from './lib/components/git/GitPanel.svelte';
  import SidebarRail from './lib/components/sidebar/SidebarRail.svelte';
  import ThemeEditor from './lib/components/theme/ThemeEditor.svelte';
  import FileSearch from './lib/components/filetree/FileSearch.svelte';
  import FindInFiles from './lib/components/filetree/FindInFiles.svelte';
  import CommandPalette from './lib/components/palette/CommandPalette.svelte';
  import SurfaceLayer from './lib/components/theme/SurfaceLayer.svelte';
  import StatusBar from './lib/components/statusbar/StatusBar.svelte';
  import CwdBreadcrumb from './lib/components/statusbar/CwdBreadcrumb.svelte';
  import Preview from './lib/components/preview/Preview.svelte';
  import FileDiagram from './lib/components/diagram/FileDiagram.svelte';
  import GitGraphView from './lib/components/git/GitGraphView.svelte';
  import Toast from './lib/components/Toast.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { openFiles, activeFile, activeFilePath, activeFileModified, addFile, autosaveEnabled, projectRoot, gitBranch, showSettings, showTerminal, showPreview, isTerminalPath, isPreviewPath, isDiagramPath, isDiffPath, getDiffFilePath, getDiagramFilePath, PREVIEW_PATH, isGitGraphPath, GIT_GRAPH_PATH, showGitGraph, terminalTabs, activeTerminalTabId, createTerminalSignal, splitTerminalSignal, terminalCdSignal, terminalSearchSignal, appearanceMode, uiZoom, uiDensity, apiKey, openaiApiKey, anthropicApiKey, sharedGitStatus, nextTab, prevTab, showChat, sidebarView, sidebarVisible, selectSidebarView, toggleSidebar, toggleChatPanel, toggleGitPanel, showFindInFiles, toggleFindInFiles, showCommandPalette, type PaletteAction, activeCustomThemeId, customThemes, applyActiveTheme, editorTheme, isThemeTabPath, getThemeTabId, themeTabPath, openThemeTab, openThemeTabs, onThemeEdit, reloadCustomThemes, fileTreeNavTarget, terminalPath, openFileSearchSignal, openDiagramSearchSignal, openDiagrams, diagramPath, terminalMode, saveConversationNow, createFileSignal, createFolderSignal, breadcrumbSegmentsFor, cwdBreadcrumbSegments, activeTerminalCwd, createPanelResizer, type PanelTarget } from './lib/modules';
  import { scheduleSaveSession, saveSessionNow } from './lib/modules/session';
  import { log } from './lib/modules/logging';
  import { isMac, isFullscreen, installWindowChromeWatchers, openSettingsWindow } from './lib/modules/ui';
  import { showToast } from './lib/modules/ui/toast';
  import { toggleTerminal } from './lib/modules/terminal';
  import { shortcutBindings, APP_LEVEL_SHORTCUT_IDS, type AppLevelShortcutId, createChordMatcher, normalizeKeyEvent } from './lib/modules/shortcuts';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  const viewerExts = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'pdf', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'flac',
  ]);

  function isViewerFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return viewerExts.has(ext);
  }

  function isJsonFile(path: string): boolean {
    return path.toLowerCase().endsWith('.json');
  }

  let openFolderByPath: ((path: string, restoreSession?: boolean) => Promise<void>) | null = null;

  function handleOpenFolder(fn: (path: string, restoreSession?: boolean) => Promise<void>) {
    openFolderByPath = fn;
  }

  async function openProjectFromToolbar(path: string) {
    if (!openFolderByPath) return;
    await openFolderByPath(path);
  }

  async function openFolderDialog() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && openFolderByPath) {
      await openFolderByPath(selected as string);
    }
  }

  async function newProjectDialog() {
    const parentDir = await openDialog({ directory: true, multiple: false, title: 'Choose location for new project' });
    if (!parentDir) return;
    const name = window.prompt('Project name:');
    if (!name || !name.trim()) return;
    const projectPath = `${parentDir}/${name.trim()}`;
    try {
      await invoke('create_project_dir', { path: projectPath });
      if (openFolderByPath) await openFolderByPath(projectPath);
    } catch (e) {
      showToast({ level: 'error', message: `Failed to create project: ${e}` });
    }
  }

  let clonePaletteOpen = $state(false);

  async function cloneRepoDialog() {
    clonePaletteOpen = true;
  }

  async function handleCloneSubmit(url: string) {
    clonePaletteOpen = false;
    const parentDir = await openDialog({ directory: true, multiple: false, title: 'Choose where to clone' });
    if (!parentDir) return;
    try {
      const repoName = url.split('/').pop()?.replace(/\.git$/, '') || 'repo';
      showToast({ level: 'info', message: `Cloning ${repoName}...` });
      await invoke('git_clone', { url, dest: parentDir as string });
      const projectPath = `${parentDir}/${repoName}`;
      if (openFolderByPath) await openFolderByPath(projectPath);
    } catch (e) {
      showToast({ level: 'error', message: `Clone failed: ${e}` });
    }
  }

  let showFileSearch = $state(false);
  let showDiagramSearch = $state(false);
  let sidebarWidth = $state(300);

  // Git view is mounted lazily on first switch, then kept mounted (display
  // toggled) so its polling/state survive; FileTree stays mounted always so
  // its watcher + cwd-follow effect keep running behind the git view.
  let gitMounted = $state(false);
  $effect(() => { if ($sidebarView === 'git') gitMounted = true; });
  let changedCount = $derived(Object.keys($sharedGitStatus).length);

  let chatWidth = $state(320);

  // --- Drag resize logic ---
  // The state machine (rAF coalescing, body-cursor toggle, listener
  // lifecycle) lives in modules/layout/panelResize.ts so it's testable
  // independently. The component just owns the three width cells.
  let dragging = $state<PanelTarget | null>(null);
  const panelResizer = createPanelResizer({
    sidebar: { min: 295, max: 500 },
    chat:    { min: 200, max: 600 },
    setSidebarWidth: (w) => { sidebarWidth = w; },
    setChatWidth:    (w) => { chatWidth = w; },
    onDragStateChange: (t) => { dragging = t; },
  });
  const startDrag = (t: PanelTarget) => panelResizer.startDrag(t);

  // toggleTerminal() lives in `./lib/modules/terminalActions` so it's
  // shared between App.svelte (Cmd+`), TitleBar.svelte's terminal
  // button, and the status-bar terminal button. See that module for
  // the mode-aware behavior.

  let isClosing = false;

  // openSettingsWindow lives in lib/modules/ui/windows so the same
  // helper can be invoked from the toolbar, the command palette, or
  // any other launch point without re-implementing the focus-or-spawn
  // dance. We just keep the reactive subscription to `showSettings`
  // here because it's a Svelte-level concern.

  // Treat `showSettings` as an "open settings" trigger. Reset it after
  // launching so the Toolbar's toggle reads as off again.
  showSettings.subscribe((v) => {
    if (v) {
      openSettingsWindow();
      showSettings.set(false);
    }
  });

  let breadcrumbSegments = $derived(
    breadcrumbSegmentsFor($activeFilePath, $projectRoot)
  );

  // Bottom-left breadcrumb for terminals: the active terminal's cwd as
  let homeDir = $state<string | null>(null);
  let terminalCwdSegments = $derived(cwdBreadcrumbSegments($activeTerminalCwd, homeDir));

  function navigateBreadcrumb(path: string) {
    if (!$sidebarVisible) toggleSidebar();
    fileTreeNavTarget.set(path);
  }

  /** 
   *  The file tree follows automatically via the OSC-7 cwd report. */
  function cdTerminal(path: string) {
    showTerminal.set(true);
    terminalCdSignal.update(s => ({ count: s.count + 1, path }));
  }

  onMount(async () => {
    // Install the fullscreen / platform-chrome watchers as early as
    // possible so the toolbar can render with the right padding from
    // the very first frame. The teardown isn't captured because this
    // component lives for the entire app lifetime.
    void installWindowChromeWatchers().catch(() => {});

    // Home dir for the terminal cwd breadcrumb (`~` collapsing).
    void invoke<string>('get_home_dir').then(h => { homeDir = h; }).catch(() => {});

    // Load API keys from OS keychain into stores
    const providers = ['openrouter', 'openai', 'anthropic'] as const;
    const storeMap = { openrouter: apiKey, openai: openaiApiKey, anthropic: anthropicApiKey } as const;
    async function loadKeys() {
      for (const provider of providers) {
        try {
          const key: string = await invoke('get_provider_key', { provider });
          storeMap[provider].set(key || '');
        } catch { /* keychain unavailable or empty */ }
      }
    }
    await loadKeys();

    // Reload keys when window regains focus (e.g. after closing settings)
    const onFocus = () => { loadKeys(); };
    window.addEventListener('focus', onFocus);

    // Initialize knowledge store when project root is set
    const unsubRoot = projectRoot.subscribe((root) => {
      if (root) {
        invoke('knowledge_init', { projectRoot: root }).then(() => {
          invoke('knowledge_index', { projectRoot: root }).catch(() => {});
        }).catch((e) => { log.warn('knowledge_init failed', e); });
        // Also persist for settings window
        localStorage.setItem('leo-project-root', root);
        // Update window title to show project name
        const name = root.split('/').pop() || 'leo';
        getCurrentWindow().setTitle(name).catch(() => {});
      }
    });

    // Handle restored sessions: if the user's saved `activeFilePath` is
    // a terminal sentinel but their current layout is panel mode, move
    // the editor off the terminal path once on startup. The mode-change
    // $effect above handles live flips; this is the one-shot equivalent
    // for cold start.
    if (get(terminalMode) === 'panel' && isTerminalPath(get(activeFilePath))) {
      activeFilePath.set(get(openFiles).at(-1)?.path ?? null);
    }

    // ── Menu event listeners ──
    const { listen } = await import('@tauri-apps/api/event');
    await listen('menu:open-folder', () => { openFolderDialog(); });
    await listen('menu:save', () => { document.dispatchEvent(new CustomEvent('menu-save')); });
    await listen('menu:save-all', () => { document.dispatchEvent(new CustomEvent('menu-save-all')); });
    await listen('menu:close-tab', () => { document.dispatchEvent(new CustomEvent('menu-close-tab')); });
    await listen('menu:close-window', async () => { (await import('@tauri-apps/api/window')).getCurrentWindow().close(); });
    await listen('menu:toggle-file-tree', () => { toggleSidebar(); });
    await listen('menu:toggle-ai-panel', () => { toggleChatPanel(); });
    await listen('menu:toggle-terminal', () => { toggleTerminal(); });
    await listen('menu:toggle-sidebar', () => { toggleSidebar(); });
    await listen('menu:go-to-file', () => { showFileSearch = true; });
    await listen('menu:new-file', () => { createFileSignal.set(Date.now()); });
    await listen('menu:toggle-fullscreen', async () => {
      const win = (await import('@tauri-apps/api/window')).getCurrentWindow();
      const full = await win.isFullscreen();
      await win.setFullscreen(!full);
    });
    await listen('menu:reload', () => { location.reload(); });
    await listen('menu:open-settings', () => { openSettingsWindow(); });
    await listen('menu:find', () => { document.dispatchEvent(new CustomEvent('menu-find')); });
    await listen('menu:replace', () => { document.dispatchEvent(new CustomEvent('menu-replace')); });
    await listen('menu:toggle-comment', () => { document.dispatchEvent(new CustomEvent('menu-toggle-comment')); });
    await listen('menu:indent', () => { document.dispatchEvent(new CustomEvent('menu-indent')); });
    await listen('menu:outdent', () => { document.dispatchEvent(new CustomEvent('menu-outdent')); });
    await listen('menu:undo-last-ai-edit', () => { document.dispatchEvent(new CustomEvent('menu-undo-ai-edit')); });
    await listen('menu:go-to-line', () => { document.dispatchEvent(new CustomEvent('menu-go-to-line')); });
    await listen('menu:go-to-symbol', () => { showDiagramSearch = true; });
    await listen('menu:back', () => { document.dispatchEvent(new CustomEvent('menu-back')); });
    await listen('menu:forward', () => { document.dispatchEvent(new CustomEvent('menu-forward')); });
    await listen('menu:revert-file', () => { document.dispatchEvent(new CustomEvent('menu-revert-file')); });
    await listen('menu:toggle-devtools', async () => {
      const win = (await import('@tauri-apps/api/window')).getCurrentWindow();
      // @ts-ignore — internal API available in debug builds
      if ((win as any).__TAURI_INTERNALS__) { (win as any).__TAURI_INTERNALS__.invoke('plugin:webview|internal_toggle_devtools'); }
    });
    await listen('menu:documentation', async () => { (await import('@tauri-apps/plugin-shell')).open('https://github.com/chewton2k/leo-ide'); });
    await listen('menu:report-issue', async () => { (await import('@tauri-apps/plugin-shell')).open('https://docs.google.com/forms/d/e/1FAIpQLSe1Dsog4TyfOHtNnQaMMKLqfcnWlTFNW2U9RcAnF-E5PB_NCw/viewform?usp=publish-editor'); });

    // Pull initial project for this window (set by open_folder_in_new_window)
    try {
      const initialProject: string | null = await invoke('get_initial_project');
      if (initialProject && openFolderByPath) {
        await openFolderByPath(initialProject);
      } else if (openFolderByPath && get(projectRoot) === null) {
        try {
          const home = await invoke<string>('get_home_dir');
          await openFolderByPath(home, false);
          toggleTerminal();
        } catch { /* home unavailable — fall back to the welcome screen */ }
      }
    } catch { /* no initial project — normal for main window */ }

    // The settings window asks us (the main window) to open a custom theme as
    // a JSON editor tab. Re-read the store first so a just-created theme exists.
    void onThemeEdit((req) => {
      reloadCustomThemes();
      openThemeTab(req.id);
      activeFilePath.set(themeTabPath(req.id));
    });

    // Save session on window close — await the save before destroying
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(async (event) => {
      if (isClosing) return;
      isClosing = true;
      event.preventDefault();
      const root = get(projectRoot);
      if (root) {
        try {
          // Save the AI conversation, then the editor session.
          await saveConversationNow();
          // Save session
          await Promise.race([
            saveSessionNow(root),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Save timeout')), 5000)
            ),
          ]);
        } catch (e) {
          log.error('Failed to save session on close', e);
        }
      }
      await appWindow.destroy();
    });
  });

  // Apply appearance mode (system/light/dark)
  $effect(() => {
    const mode = $appearanceMode;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (mode === 'light') root.classList.add('light');
    else if (mode === 'dark') root.classList.add('dark');
    else {
      // system: use OS preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'dark' : 'light');
    }
  });

  // Apply UI zoom via a CSS var consumed only by `.ide-top` (the working
  // tab bar and status bar stay at 100% so nothing gets clipped past 100%.
  $effect(() => {
    document.documentElement.style.setProperty('--app-zoom', String($uiZoom || 1));
  });

  // Apply the active custom theme (CSS-var overrides) reactively.
  $effect(() => {
    $activeCustomThemeId;
    $customThemes;
    applyActiveTheme($editorTheme);
  });

  // Prune theme tabs whose theme was deleted (e.g. from the settings window).
  $effect(() => {
    const ids = new Set($customThemes.map(t => t.id));
    const open = get(openThemeTabs);
    const alive = open.filter(id => ids.has(id));
    if (alive.length !== open.length) {
      openThemeTabs.set(alive);
      const active = get(activeFilePath);
      if (isThemeTabPath(active) && !ids.has(getThemeTabId(active ?? ''))) {
        activeFilePath.set(get(openFiles).at(-1)?.path ?? null);
      }
    }
  });

  // Apply UI density
  $effect(() => {
    document.documentElement.dataset.density = $uiDensity;
  });

  // Expose the active theme as a data attribute so theme-scoped CSS (e.g. the
  // plum glass effect) can target it. Custom themes opt out of theme styling.
  $effect(() => {
    document.documentElement.dataset.theme = $activeCustomThemeId ? 'custom' : $editorTheme;
  });

  // ── Terminal mode transitions ──────────────────────────────────
  //
  // When the user flips between 'tab' ↔ 'panel' we wipe the slate:
  // hide the terminal surface and redirect the editor off any
  // terminal sentinel. PTY processes are killed by Terminal.svelte's
  // own `onDestroy` when its container unmounts as a result of the
  // mode change — we deliberately do NOT dispatch a kill signal here
  // because that would queue async work into the about-to-be-destroyed
  // component, which can then race against (and stomp on) a freshly
  // mounted Terminal instance the user opens immediately afterwards.
  //
  // We also do NOT auto-spawn a new terminal in the new container —
  // doing so in tab mode would steal `activeFilePath` (Terminal.svelte
  // routes it to the new terminal on create) and cover whatever file
  // the user was editing. The user opens a terminal themselves via
  // the status-bar button / Ctrl+` / the "+" menu when they want one.
  let prevTerminalMode: 'tab' | 'panel' | null = null;
  $effect(() => {
    const mode = $terminalMode;
    if (prevTerminalMode !== null && prevTerminalMode !== mode) {
      showTerminal.set(false);
      if (isTerminalPath(get(activeFilePath))) {
        activeFilePath.set(get(openFiles).at(-1)?.path ?? null);
      }
    }
    prevTerminalMode = mode;
  });

  // Auto-save session when open files or active file changes
  $effect(() => {
    // Subscribe to reactive stores
    const _ = $openFiles;
    const __ = $activeFile;
    scheduleSaveSession();
  });

  $effect(() => {
    if ($openFileSearchSignal > 0) {
      showFileSearch = true;
    }
  });

  $effect(() => {
    if ($openDiagramSearchSignal > 0) {
      showDiagramSearch = true;
    }
  });

  // Keep preview alive once opened
  $effect(() => {
    if (isPreviewPath($activeFilePath)) showPreview.set(true);
  });

  $effect(() => {
    if (isGitGraphPath($activeFilePath)) showGitGraph.set(true);
  });

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      // The editor owns Cmd+K for inline AI edit when there's a selection; in
      // that case it calls preventDefault, so we defer. With no selection the
      // editor lets it fall through and Cmd+K opens the command palette.
      if (e.defaultPrevented) return;
      e.preventDefault();
      showCommandPalette.update(v => !v);
      return;
    }
    dispatchAppShortcut(e);
  }

  const paletteExtras: PaletteAction[] = [
    { id: 'view.terminal', label: 'Toggle Terminal', group: 'View', keywords: ['shell', 'console'], run: () => toggleTerminal() },
    { id: 'view.sidebar', label: 'Toggle Sidebar', group: 'View', keywords: ['explorer', 'files'], run: () => toggleSidebar() },
    { id: 'terminal.search', label: 'Search Terminal', group: 'Search', keywords: ['find', 'terminal'], run: () => { $showTerminal = true; terminalSearchSignal.update(n => n + 1); } },
  ];

  /**
   * Match `e` against the app-level shortcut bindings and run the
   * corresponding action. Returns true if the event was handled (caller
   * is responsible for preventing default / stopping propagation as
   * appropriate for the phase it's running in).
   *
   * Editor (CodeMirror) and tab-system shortcuts like `editor.find` or
   * `file.save` are deliberately excluded — they're owned by the
   * focused control, not the app shell. Adding a new app-level
   * shortcut means: add the id to APP_LEVEL_SHORTCUT_IDS in
   * shortcuts.ts and add the action below. TypeScript enforces that
   * the action map covers every id (`Record<AppLevelShortcutId, …>`).
   */
  let appChordMatcher: ReturnType<typeof createChordMatcher> | null = null;
  let chordResetTimer: ReturnType<typeof setTimeout> | null = null;

  function dispatchAppShortcut(e: KeyboardEvent): boolean {
    const actions: Record<AppLevelShortcutId, () => void> = {
      'view.toggleTerminal': () => toggleTerminal(),
      'view.toggleChat':     () => toggleChatPanel(),
      'view.toggleGit':      () => toggleGitPanel(),
      'view.toggleSidebar':  () => toggleSidebar(),
      'view.openSettings':   () => showSettings.set(true),
      'file.search':         () => { showFileSearch = !showFileSearch; },
      'tabs.nextAlt':        () => nextTab(),
      'tabs.prevAlt':        () => prevTab(),
      'tabs.next':           () => nextTab(),
      'tabs.prev':           () => prevTab(),
      'terminal.splitRight': () => { showTerminal.set(true); splitTerminalSignal.update(s => ({ count: s.count + 1, direction: 'right' })); },
      'terminal.splitDown':  () => { showTerminal.set(true); splitTerminalSignal.update(s => ({ count: s.count + 1, direction: 'bottom' })); },
      'terminal.new':        () => { showTerminal.set(true); createTerminalSignal.update(s => ({ count: s.count + 1, forceNew: true })); },
    };

    // If a focused control already handled this key (e.g. the editor's
    // Cmd+D = select-next-occurrence calls preventDefault), let it win.
    // The terminal capture path runs before any control, so defaultPrevented
    // is false there and terminal shortcuts (Cmd+D split, …) still fire.
    if (e.defaultPrevented) return false;

    if (!appChordMatcher) {
      appChordMatcher = createChordMatcher(() => {
        const b = $shortcutBindings;
        return Object.fromEntries(APP_LEVEL_SHORTCUT_IDS.map(id => [id, b[id] ?? '']));
      });
    }
    const chord = normalizeKeyEvent(e);
    if (!chord) return false;
    const r = appChordMatcher.feed(chord);
    if (chordResetTimer) { clearTimeout(chordResetTimer); chordResetTimer = null; }
    if (r.status === 'match') { e.preventDefault(); actions[r.id as AppLevelShortcutId](); return true; }
    if (r.status === 'pending') {
      e.preventDefault();
      chordResetTimer = setTimeout(() => appChordMatcher?.reset(), 1000);
      return true;
    }
    return false;
  }


  function handleKeydownCapture(e: KeyboardEvent) {
    if (e.isComposing) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.terminal-content')) return;
    if (dispatchAppShortcut(e)) {
      e.stopImmediatePropagation();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydownCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeydownCapture, { capture: true });
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="ide-layout" class:mac-traffic-lights={isMac && !$isFullscreen}>
  <TitleBar sidebarVisible={$sidebarVisible} onToggleSidebar={toggleSidebar} />
  <Toolbar
    onOpenProject={openProjectFromToolbar}
    onOpenFolderDialog={openFolderDialog}
    onNewProject={newProjectDialog}
    onCloneRepo={cloneRepoDialog}
    onSearchFiles={() => { showFileSearch = !showFileSearch; }}
    onNewFile={() => createFileSignal.update(n => n + 1)}
    onNewFolder={() => createFolderSignal.update(n => n + 1)}
  />
  <div class="ide-top">
    <div class="sidebar" class:hidden={!$sidebarVisible} style="width: {sidebarWidth}px">
      <div class="sidebar-body">
        <div class="sidebar-pane" style:display={$sidebarView === 'git' ? 'none' : ''}>
          <FileTree onFileSelect={(path, name) => addFile(path, name)} onSearchFiles={() => showFileSearch = true} onOpenFolder={handleOpenFolder} />
        </div>
        {#if gitMounted}
          <div class="sidebar-pane" style:display={$sidebarView === 'git' ? '' : 'none'}>
            <GitPanel />
          </div>
        {/if}
      </div>
      <SidebarRail activeView={$sidebarView} onSelect={selectSidebarView} {changedCount} />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle resize-handle-col" class:hidden={!$sidebarVisible} onmousedown={startDrag('sidebar')}></div>

    <div class="main-area">
      <div class="editor-col">
        <div class="editor-area" style="flex: 1; min-height: 0;">
          <div class="editor-container">
            <!--
              Tab-mode terminal slot: visible only when the user has chosen
              the legacy in-tab terminal layout. In panel mode the terminal
              is rendered by <TerminalPanel /> below and this slot is absent.
              Kept in the DOM (visibility:hidden when unfocused) so PTY
              sessions survive tab switches within tab mode.
            -->
            {#if $terminalMode === 'tab'}
              <div class="terminal-tab-slot" class:focused={$showTerminal && isTerminalPath($activeFilePath)} style:display={$showTerminal ? '' : 'none'}>
                <Terminal />
              </div>
            {/if}
            <!-- Preview tab: kept alive like terminal -->
            {#if $showPreview}
              <div class="terminal-tab-slot" class:focused={isPreviewPath($activeFilePath)}>
                <Preview />
              </div>
            {/if}
            <!-- Diagram tab -->
            {#if isDiagramPath($activeFilePath)}
              <div class="terminal-tab-slot focused">
                <FileDiagram filePath={getDiagramFilePath($activeFilePath ?? '')} />
              </div>
            {/if}
            <!-- Git graph tab -->
            {#if isGitGraphPath($activeFilePath)}
              <div class="terminal-tab-slot focused">
                <GitGraphView />
              </div>
            {/if}
            <!-- Theme editor tab (custom theme JSON) -->
            {#if isThemeTabPath($activeFilePath)}
              <div class="terminal-tab-slot focused">
                {#key getThemeTabId($activeFilePath ?? '')}
                  <ThemeEditor themeId={getThemeTabId($activeFilePath ?? '')} />
                {/key}
              </div>
            {/if}
            <!-- File editor — hidden while a terminal or preview tab is focused -->
            {#if !($showTerminal && isTerminalPath($activeFilePath)) && !isPreviewPath($activeFilePath) && !isDiagramPath($activeFilePath) && !isGitGraphPath($activeFilePath) && !isThemeTabPath($activeFilePath)}
              {#if $activeFile && isDiffPath($activeFilePath)}
                <DiffViewer filePath={getDiffFilePath($activeFilePath ?? '')} />
              {:else if $activeFile && $sharedGitStatus[$activeFile] === 'C'}
                <MergeEditor filePath={$activeFile} />
              {:else if $activeFile && isJsonFile($activeFile)}
                <JSONViewer filePath={$activeFile} />
              {:else if $activeFile && isViewerFile($activeFile)}
                <FileViewer filePath={$activeFile} />
              {:else if $activeFile}
                <Editor filePath={$activeFile} />
              {/if}
            {/if}
          </div>
        </div>

      </div>
    </div>

    {#if $showChat}
      <!-- Floating chat rendered below -->
    {/if}

    {#if $showFindInFiles}
      <div class="git-panel-container" style="width: 320px">
        <div class="panel-header">
          <span>Search</span>
          <button onclick={toggleFindInFiles}>✕</button>
        </div>
        <FindInFiles />
      </div>
    {/if}


    {#if showFileSearch}
      <FileSearch onClose={() => showFileSearch = false} />
    {/if}

    {#if $showCommandPalette}
      <CommandPalette extraActions={paletteExtras} onClose={() => showCommandPalette.set(false)} />
    {/if}

    {#if clonePaletteOpen}
      <FileSearch mode="clone" onClose={() => clonePaletteOpen = false} onSubmit={handleCloneSubmit} />
    {/if}

    {#if showDiagramSearch}
      <FileSearch onClose={() => showDiagramSearch = false} onSelect={(relPath) => {
        const root = get(projectRoot);
        if (!root) return;
        const fullPath = `${root}/${relPath}`;
        openDiagrams.update(d => d.includes(fullPath) ? d : [...d, fullPath]);
        activeFilePath.set(diagramPath(fullPath));
      }} />
    {/if}
  </div>

  {#if $terminalMode === 'panel'}
    <!--
      Bottom-docked terminal panel (VSCode / Xcode / Zed style). The panel
      stays in the DOM while in panel mode so xterm + PTY state survives
      visibility toggles; the component CSS-hides itself when
      `$showTerminal` is false.
    -->
    <TerminalPanel />
  {/if}

  <div class="statusbar">
    <div class="statusbar-left">
      {#if isTerminalPath($activeFilePath)}
        {#if terminalCwdSegments.length > 0}
          <CwdBreadcrumb segments={terminalCwdSegments} onCd={cdTerminal} />
        {:else}
          <span class="breadcrumb-plain">Terminal</span>
        {/if}
      {:else if isPreviewPath($activeFilePath)}
        <span class="breadcrumb-plain">Preview</span>
      {:else if isGitGraphPath($activeFilePath)}
        <span class="breadcrumb-plain">Git Graph</span>
      {:else if isDiagramPath($activeFilePath)}
        <span class="breadcrumb-plain">Diagram: {getDiagramFilePath($activeFilePath ?? '').split('/').pop()}</span>
      {:else if breadcrumbSegments.length > 0}
        <div class="breadcrumb">
          {#each breadcrumbSegments as seg, i}
            <span class="breadcrumb-seg" role="button" tabindex="0" onclick={() => navigateBreadcrumb(seg.path)} onkeydown={(e) => e.key === 'Enter' && navigateBreadcrumb(seg.path)}>
              {#if i === 0}
                <span class="breadcrumb-dot"></span>
              {/if}
              {seg.name}
            </span>
            {#if i < breadcrumbSegments.length - 1}
              <span class="breadcrumb-sep">›</span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    <div class="statusbar-right">
      <StatusBar />
      {#if $terminalMode === 'panel'}
        <button
          class="statusbar-terminal-btn"
          class:active={$showTerminal}
          onclick={toggleTerminal}
          title="Toggle terminal (Ctrl+`)"
          aria-label="Toggle terminal panel"
          aria-pressed={$showTerminal}
        >
          <TerminalSquare size={12} />
        </button>
      {/if}
      {#if $activeFile}
        <span class="save-indicator" class:saved={!$activeFileModified} class:unsaved={$activeFileModified}>
          {#if $activeFileModified}
            <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
              <circle cx="8" cy="8" r="5" />
            </svg>
            Unsaved
          {:else}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
              <path d="M3 8.5l3.5 3.5 6.5-7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Saved
          {/if}
        </span>
      {/if}
      <button class="statusbar-ai-btn" class:active={$showFindInFiles} onclick={toggleFindInFiles} title="Search in Files">
        <Search size={13} />
      </button>
      <button class="statusbar-ai-btn" class:active={$showChat} onclick={() => showChat.update(v => !v)} title="Leo AI (Ctrl+L)">
        <Sparkles size={13} />
      </button>
    </div>
  </div>
</div>

<FloatingChat />
<Toast />
<SurfaceLayer />

<style>
  .ide-layout {
    display: grid;
    /*
     * Row layout:
     *   1. toolbar / tab bar
     *   2. main content (minmax(0, 1fr) — absorbs remaining height, but is
     *      also allowed to shrink to zero so the terminal panel can take
     *      as much vertical space as the user drags it to)
     *   3. terminal panel (auto — collapses to 0 when not rendered)
     *   4. statusbar
     *
     * `minmax(0, 1fr)` instead of plain `1fr` is critical: a bare `1fr`
     * is really `minmax(auto, 1fr)`, which refuses to shrink below the
     * main content's min-content height. When the terminal panel gets
     * tall, that would push the statusbar out of the viewport (clipped
     * by `overflow: hidden` on this container) — observed as the
     * breadcrumbs row "moving" / disappearing.
     *
     * Each direct child is also pinned to an explicit `grid-row` below
     * (see selectors). That prevents a very subtle failure mode where
     * auto-flow would collapse positions when the panel row is unused:
     *   - In tab mode there is no TerminalPanel child, only 3 elements.
     *   - In panel mode with the panel hidden, its <section> has
     *     `display: none`, so it's excluded from grid placement.
     * Without explicit pinning, the statusbar would land in row 3
     * (the `auto` panel row), leaving row 4 as a 24px empty gap and
     * appearing "pushed up" off the bottom.
     */
    grid-template-rows:
      [titlebar] var(--density-titlebar-height, 32px)
      [toolbar]  var(--density-tabs-height, 36px)
      [main]     minmax(0, 1fr)
      [panel]    auto
      [status]   var(--density-statusbar-height, 24px);
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  /*
   * Pin every direct grid child to its intended row by named grid lines.
   * This makes the layout robust to conditional rendering and to any
   * component hiding itself via `display: none`. The named lines above
   * in `grid-template-rows` are what these selectors reference.
   */
  .ide-layout > :global(.title-bar)      { grid-row: titlebar; }
  .ide-layout > :global(.toolbar)        { grid-row: toolbar; }
  .ide-layout > .ide-top                 { grid-row: main; }
  .ide-layout > :global(.terminal-panel) { grid-row: panel; }
  .ide-layout > .statusbar               { grid-row: status; }

  /*
   * macOS title-bar integration.
   *
   * With `titleBarStyle: "Overlay"` set in tauri.conf.json, the system
   * traffic-light buttons (close / minimize / maximize) float over the
   * top-left of our content. Reserve horizontal space at the start of
   * the title bar so they don't collide with our first button.
   *
   * 78px = ~70px for the three traffic-light buttons plus an 8px gap.
   * Matches VSCode and Zed's macOS layouts.
   *
   * In fullscreen the system hides the traffic lights, so we drop the
   * padding to reclaim the full title-bar width — the
   * `.mac-traffic-lights` class is removed by App.svelte when
   * `$isFullscreen` flips true.
   *
   * The drag region itself lives entirely on .title-bar (set inside the
   * TitleBar component). We do NOT mark .toolbar (the tab bar below) as
   * draggable — tabs occupy almost all of its width, so the user
   * effectively wouldn't have any empty area to grab anyway, and
   * accidental drags from in-between-tabs gaps would be confusing.
   */
  .ide-layout.mac-traffic-lights > :global(.title-bar) {
    padding-left: 78px;
  }

  .ide-top {
    display: flex;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    zoom: var(--app-zoom, 1);
  }

  .sidebar {
    background: var(--bg-primary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    min-width: 100px;
  }

  .sidebar-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .sidebar-pane { flex: 1; min-height: 0; overflow: hidden; }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-width: 0;
    min-height: 0;
  }

  .editor-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .editor-area {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-container {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .terminal-tab-slot {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    visibility: hidden;
    pointer-events: none;
    z-index: 1;
  }

  .terminal-tab-slot.focused {
    visibility: visible;
    pointer-events: auto;
  }

  /* Resize handles */
  .resize-handle {
    flex-shrink: 0;
    background: transparent;
    transition: background 0.15s;
    z-index: 10;
  }

  .resize-handle:hover,
  .resize-handle:active {
    background: var(--accent);
  }

  .resize-handle-col {
    width: 3px;
    cursor: col-resize;
  }

  .hidden {
    display: none !important;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .panel-header button {
    font-size: 14px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 3px;
  }

  .panel-header button:hover {
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .git-panel-container {
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex-shrink: 0;
    min-width: 200px;
  }

  .statusbar {
    background: var(--statusbar-bg, var(--accent));
    color: var(--statusbar-text, #E8E2D5);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 14px;
    height: var(--density-statusbar-height, 28px);
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    flex-shrink: 0;
  }

  .statusbar-left, .statusbar-right {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
    flex-shrink: 1;
    overflow: hidden;
    height: 100%;
  }

  .statusbar-left {
    flex: 1;
  }

  .statusbar-right {
    flex-shrink: 0;
  }

  .save-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 3px;
    transition: all 0.2s ease;
  }

  .save-indicator.saved {
    opacity: 0.85;
  }

  .save-indicator.unsaved {
    opacity: 1;
  }

  .statusbar-ai-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: var(--statusbar-text, #E8E2D5);
    cursor: pointer;
    transition: background 0.15s;
    margin-left: 8px;
  }

  .statusbar-ai-btn:hover {
    background: var(--bg-surface);
    color: var(--statusbar-text, #E8E2D5);
  }

  .statusbar-ai-btn.active {
    color: var(--statusbar-text, #E8E2D5);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /*
   * Bottom-right terminal toggle. Only rendered in panel mode; kept
   * close to the AI button so the two "utility toggles" cluster visually
   * on the right edge, matching VSCode/Zed conventions.
   */
  .statusbar-terminal-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    height: 24px;
    border-radius: 4px;
    color: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    border: none;
    transition: background 0.15s ease;
  }
  .statusbar-terminal-btn:hover {
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .statusbar-terminal-btn.active {
    background: color-mix(in srgb, currentColor 26%, transparent);
  }
  .statusbar-terminal-btn:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: -2px;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    padding-left: 8px;
  }

  .breadcrumb-seg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 0;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    color: inherit;
    cursor: pointer;
    transition: opacity 0.1s;
  }

  .breadcrumb-seg:hover {
    opacity: 0.7;
  }

  .breadcrumb-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .breadcrumb-sep {
    opacity: 0.75;
    font-size: 12.5px;
    font-weight: 600;
    flex-shrink: 0;
    color: inherit;
  }

  .breadcrumb-plain {
    font-size: 13px;
    color: inherit;
    opacity: 0.85;
    padding: 0 8px;
  }
</style>
