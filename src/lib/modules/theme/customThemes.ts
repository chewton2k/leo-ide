import { writable, get } from 'svelte/store';
import { persistedString } from '../session/persisted';
import type { CustomTheme } from './validateTheme';
import { paletteFromSeed } from './themes';

const KEY = 'leo-custom-themes';

function load(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(list: CustomTheme[]): void {
  if (list.length === 0) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(list));
}

export const customThemes = writable<CustomTheme[]>(load());

/** A fresh custom theme exposing every themeable variable so the user can
 *  customize everything from the JSON tab (not just a handful). */
export function starterCustomTheme(): CustomTheme {
  return {
    id: 'my-theme-' + Math.random().toString(36).slice(2, 10),
    name: 'My Theme',
    vars: paletteFromSeed({
      bg: '#1a1b26', bg2: '#16161e', bg3: '#13131a', surface: '#1f2335',
      text: '#c0caf5', text2: '#a9b1d6', muted: '#565f89',
      accent: '#7aa2f7', border: '#29304d',
      success: '#9ece6a', warning: '#e0af68', error: '#f7768e',
    }),
  };
}

/** id of the applied custom theme; '' means none (use built-in dark/light). */
export const activeCustomThemeId = persistedString('leo-active-custom-theme', '');

/**
 * Create a new custom theme seeded from an existing theme's variables (a
 * built-in palette from `builtinThemeVars`, or another custom theme's vars).
 * Returns the new theme; the caller saves/activates/opens it. The name gets a
 * " (copy)" suffix so duplicates are easy to tell apart.
 */
export function copyThemeToCustom(source: { name: string; vars: Record<string, string> }): CustomTheme {
  return {
    id: 'my-theme-' + Math.random().toString(36).slice(2, 10),
    name: `${source.name} (copy)`,
    vars: { ...source.vars },
  };
}

export function listCustomThemes(): CustomTheme[] {
  return get(customThemes);
}

export function getCustomTheme(id: string): CustomTheme | undefined {
  return get(customThemes).find(t => t.id === id);
}

/** Insert or replace a theme by id. */
export function saveCustomTheme(theme: CustomTheme): void {
  customThemes.update(list => {
    const next = list.filter(t => t.id !== theme.id).concat(theme);
    persist(next);
    return next;
  });
}

export function deleteCustomTheme(id: string): void {
  customThemes.update(list => {
    const next = list.filter(t => t.id !== id);
    persist(next);
    return next;
  });
  if (get(activeCustomThemeId) === id) activeCustomThemeId.set('');
}

/** Re-read from localStorage (used when another window changed the list). */
export function reloadCustomThemes(): void {
  customThemes.set(load());
}
