import { writable, get } from 'svelte/store';
import { persisted, persistedString } from '../session/persisted';
import type { AppearanceMode, EditorThemeId } from '../theme/themes';

export const showSettings = writable<boolean>(false);
export const showChat = writable<boolean>(false);
export const showFindInFiles = writable<boolean>(false);
export const showCommandPalette = writable<boolean>(false);

/** Left sidebar: which view is showing, and whether it's expanded. The git
 *  panel and file tree share one sidebar, toggled by the bottom rail. */
export const sidebarView = persistedString('leo-sidebar-view', 'explorer') as import('svelte/store').Writable<'explorer' | 'git'>;
export const sidebarVisible = writable<boolean>(true);
/** When set, the Editor scrolls to and selects `line` once `path` is loaded. */
export const editorGotoTarget = writable<{ path: string; line: number } | null>(null);
export const triggerSearchInFile = writable<number>(0);
export const openFileSearchSignal = writable<number>(0);
export const createFileSignal = writable<number>(0);
export const createFolderSignal = writable<number>(0);
export const openPreviewSignal = writable<number>(0);
export const fileTreeNavTarget = writable<string | null>(null);

export function toggleChatPanel() {
  const next = !get(showChat);
  showChat.set(next);
  if (next) showFindInFiles.set(false);
}

/** Show the sidebar (expanding if collapsed) on the given view. */
export function selectSidebarView(view: 'explorer' | 'git') {
  sidebarView.set(view);
  sidebarVisible.set(true);
}

export function toggleSidebar() {
  sidebarVisible.update(v => !v);
}

/** Source-control toggle: reveal the git view in the sidebar; if it's already
 *  the visible view, collapse the sidebar. */
export function toggleGitPanel() {
  if (!get(sidebarVisible)) {
    sidebarVisible.set(true);
    sidebarView.set('git');
    return;
  }
  if (get(sidebarView) !== 'git') {
    sidebarView.set('git');
    return;
  }
  sidebarVisible.set(false);
}

export function toggleFindInFiles() {
  const next = !get(showFindInFiles);
  showFindInFiles.set(next);
  if (next) showChat.set(false);
}

// Appearance: system | light | dark
export const appearanceMode = persistedString('leo-appearance', 'system') as import('svelte/store').Writable<AppearanceMode>;

// Editor theme (CodeMirror)
export const editorTheme = persistedString('leo-editor-theme', 'plum-dark') as import('svelte/store').Writable<EditorThemeId>;

// UI
/** UI zoom level (multiplier). Applied as CSS `zoom` on the document root, so
 *  size. parseFloat (not parseInt) so fractional steps like 1.25 persist. */
export const uiZoom = persisted<number>('leo-ui-zoom', 1, raw => parseFloat(raw) || 1, v => String(v));
export const uiDensity = persistedString('leo-ui-density', 'comfortable') as import('svelte/store').Writable<'compact' | 'comfortable'>;
