import { writable } from 'svelte/store';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

const THEME_PREFIX = '__theme__:';

export function themeTabPath(id: string): string {
  return `${THEME_PREFIX}${id}`;
}
export function isThemeTabPath(path: string | null): boolean {
  return !!path?.startsWith(THEME_PREFIX);
}
export function getThemeTabId(path: string): string {
  return path.slice(THEME_PREFIX.length);
}

/** Theme ids currently open as JSON editor tabs (main window). */
export const openThemeTabs = writable<string[]>([]);

/** Open (or focus) a theme as a tab. Returns its sentinel path. */
export function openThemeTab(id: string): string {
  openThemeTabs.update(ids => (ids.includes(id) ? ids : [...ids, id]));
  return themeTabPath(id);
}

export function closeThemeTab(id: string): void {
  openThemeTabs.update(ids => ids.filter(x => x !== id));
}

// ── Cross-window edit request ────────────────────────────────────
// The settings window asks the main window to open a theme as an editor
// tab (settings is a separate Tauri window, so this travels as an event).
const THEME_EDIT_EVENT = 'leo://theme-edit';
export interface ThemeEditRequest { id: string; }

export function emitThemeEdit(req: ThemeEditRequest): Promise<void> {
  return emit(THEME_EDIT_EVENT, req);
}
export function onThemeEdit(cb: (req: ThemeEditRequest) => void): Promise<UnlistenFn> {
  return listen<ThemeEditRequest>(THEME_EDIT_EVENT, e => cb(e.payload));
}
