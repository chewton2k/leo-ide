import { writable, get, derived, type Writable } from 'svelte/store';
import { persistedString, persistedNumber, persistedBool } from '../session/persisted';

/** Opt-in: cap live terminal renderers + hibernate hidden panes (default off). */
export const terminalRendererPoolEnabled = persistedBool('leo-terminal-renderer-pool', false);

export const showTerminal = writable<boolean>(false);
export const showPreview = writable<boolean>(false);
export const showGitGraph = writable<boolean>(false);

// ── Terminal layout mode ──────────────────────────────────────────
//
// Two valid values:
//   'tab'   — terminals appear as ordinary editor tabs (legacy behavior).
//   'panel' — terminals are docked in a resizable bottom panel like VSCode,
//             Xcode or Zed. The editor always stays visible; terminal tabs
//             live inside the panel's own tab strip.
//
// Persisted so the user's choice survives reloads. Defaults to 'tab' for
// backward compatibility with existing sessions.
export type TerminalMode = 'tab' | 'panel';
export const terminalMode = persistedString('leo-terminal-mode', 'tab') as Writable<TerminalMode>;

/** Height of the docked terminal panel in pixels. Bounded by the consumer
 *  (TerminalPanel.svelte clamps to [120, 80vh] when applying). Persisted so
 *  the layout survives reloads. */
export const terminalPanelHeight = persistedNumber('leo-terminal-panel-height', 260);

export const TERMINAL_SENTINEL_PREFIX = '__terminal__';
export const PREVIEW_PATH = '__preview__';
export const GIT_GRAPH_PATH = '__gitgraph__';
export const DIAGRAM_PREFIX = '__diagram__:';
export const DIFF_PREFIX = '__diff__:';

// Legacy single-terminal path, kept so stored sessions that reference it
// still parse as "a terminal path" via `isTerminalPath`. New code should
// route through `terminalPath(tabId)`.
export const TERMINAL_WORKSPACE_PATH = `${TERMINAL_SENTINEL_PREFIX}workspace`;

export function isTerminalPath(path: string | null): boolean {
  return !!path?.startsWith(TERMINAL_SENTINEL_PREFIX);
}

export function isPreviewPath(path: string | null): boolean {
  return path === PREVIEW_PATH;
}

export function isGitGraphPath(path: string | null): boolean {
  return path === GIT_GRAPH_PATH;
}

export function isDiagramPath(path: string | null): boolean {
  return !!path?.startsWith(DIAGRAM_PREFIX);
}

export function isDiffPath(path: string | null): boolean {
  return !!path?.startsWith(DIFF_PREFIX);
}

export function diffPath(filePath: string): string {
  return `${DIFF_PREFIX}${filePath}`;
}

export function getDiffFilePath(path: string): string {
  return path.slice(DIFF_PREFIX.length);
}

export function diagramPath(filePath: string): string {
  return `${DIAGRAM_PREFIX}${filePath}`;
}

export function getDiagramFilePath(path: string): string {
  return path.slice(DIAGRAM_PREFIX.length);
}

/** Build the routing path for a specific terminal tab. */
export function terminalPath(tabId: number): string {
  return `${TERMINAL_SENTINEL_PREFIX}${tabId}`;
}

/** Parse a terminal-tab id out of a routing path. Returns null when the path
 *  doesn't reference a terminal, or when the id part isn't a valid number
 *  (which covers the legacy `__terminal__workspace` sentinel). */
export function terminalTabIdFromPath(path: string | null): number | null {
  if (!path || !path.startsWith(TERMINAL_SENTINEL_PREFIX)) return null;
  const n = parseInt(path.slice(TERMINAL_SENTINEL_PREFIX.length), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * terminal in `…/projects/leo` shows as `leo` and updates as you `cd`).
 * Falls back to `fallback` when no cwd is known yet. Handles `\` and `/`.
 */
export function terminalTabLabel(cwd: string | null | undefined, fallback: string): string {
  if (!cwd) return fallback;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : fallback;
}

// ── Pane-level session info (one entry per PTY) ────────────────────

export interface TerminalSessionInfo {
  /** Backend PTY session id (also pane id). */
  id: number;
  /** Which tab this pane belongs to. */
  tabId: number;
  name: string;
}

export const terminalSessions = writable<TerminalSessionInfo[]>([]);

// ── Tab-level state ────────────────────────────────────────────────

export interface TerminalTabInfo {
  id: number;
  name: string;
}

/** Ordered list of open terminal tabs. Each tab holds 1..N panes. */
export const terminalTabs = writable<TerminalTabInfo[]>([]);

/** The last-focused terminal tab id. Persists even while the user views a
 *  file tab, so Ctrl+` can restore focus to the same terminal. */
export const activeTerminalTabId = writable<number | null>(null);

/** Working directory of the currently-focused terminal pane (OSC 7 reported).
 *  Drives the file-tree root so the explorer follows the active terminal's cwd.
 *  null = no terminal cwd yet (fall back to project root / home). */
export const activeTerminalCwd = writable<string | null>(null);

/** One-shot spawn-dir override: when set, the NEXT terminal pane spawns here
 *  instead of the project root. Used on session restore to resume the terminal
 *  in the working directory it was left in. Consumed (cleared) on first use. */
export const pendingTerminalCwd = writable<string | null>(null);

/** Whether the explorer should re-root to follow a reported terminal cwd:
 *  only when there is a cwd and it differs from the current root. */
export function shouldFollowCwd(currentRoot: string | null, cwd: string | null): boolean {
  return !!cwd && cwd !== currentRoot;
}

// Monotonic counter for tab ids (separate from pane ids, which are chosen by
// the backend). Kept in a closure so tests or reloads restart at 1.
let nextTerminalTabId = 1;
export function allocateTerminalTabId(): number {
  const id = nextTerminalTabId++;
  return id;
}

/** Count panes belonging to a tab — used for UI state like "can collapse?". */
export const panesInActiveTab = derived(
  [terminalSessions, activeTerminalTabId],
  ([$sessions, $activeId]) => {
    if ($activeId == null) return 0;
    return $sessions.filter(s => s.tabId === $activeId).length;
  }
);

// ── Signals ────────────────────────────────────────────────────────

/**
 * Bumped each time the UI wants the Terminal component to ensure at least
 * one terminal tab is open and visible. The Terminal component handles
 * "create a new tab" vs "focus the existing one" based on its own state.
 */
export const createTerminalSignal = writable<{
  count: number;
  /** When true, always create a NEW tab; when false, only create if none exist. */
  forceNew: boolean;
}>({ count: 0, forceNew: false });

/** Bumped to close all terminals and respawn one fresh in the current
 *  project root — used when switching projects so the terminal starts in
 *  the newly-opened directory instead of a lingering cwd. */
export const resetTerminalSignal = writable<number>(0);

/** Kill a specific pane by id, all panes in a tab, or everything. */
export const killTerminalSignal = writable<
  | { kind: 'pane'; id: number }
  | { kind: 'tab'; id: number }
  | { kind: 'all' }
  | null
>(null);

export const splitTerminalSignal = writable<{
  count: number;
  direction: 'right' | 'bottom';
}>({ count: 0, direction: 'right' });

export const collapseTerminalSplitsSignal = writable<number>(0);

/** Bumped to cd the focused terminal pane to a directory (from the cwd
 *  breadcrumb). Terminal.svelte writes a `cd` command to the active pane. */
export const terminalCdSignal = writable<{ count: number; path: string }>({ count: 0, path: '' });

/** Bumped to open the in-terminal search bar (e.g. from the command palette). */
export const terminalSearchSignal = writable<number>(0);

// ── Diagram tabs (unrelated — kept here for historical reasons) ────

export const openDiagramSearchSignal = writable<number>(0);
export const openDiagrams = writable<string[]>([]);

// ── Helpers for callers that don't want to read stores directly ────

/** Returns the id of the terminal tab to focus when the user asks for "the
 *  terminal": prefers the last-active tab, falls back to the first tab, or
 *  null when none are open. */
export function preferredTerminalTabId(): number | null {
  const active = get(activeTerminalTabId);
  if (active != null) {
    const exists = get(terminalTabs).some(t => t.id === active);
    if (exists) return active;
  }
  const tabs = get(terminalTabs);
  return tabs.length > 0 ? tabs[0].id : null;
}
