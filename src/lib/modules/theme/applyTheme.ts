import { get } from 'svelte/store';
import { THEME_VARS, type CustomTheme } from './validateTheme';
import { customThemes, activeCustomThemeId } from './customThemes';
import { builtinThemeVars, type EditorThemeId } from './themes';
import { parseHexColor, contrastRatio, adjustColorForContrast, toHexColor } from '../utils/contrast';

/**
 * Minimum WCAG contrast each text color must hold against the theme's
 * background. Primary/secondary text is real reading text (AA 4.5); muted text
 * is de-emphasized, so a gentler 3.0 keeps it legible without erasing its
 * "muted" look.
 */
const TEXT_CONTRAST_TARGETS: ReadonlyArray<[string, number, string[]]> = [
  ['--text-primary', 4.5, ['--bg-primary']],
  ['--text-secondary', 4.5, ['--bg-primary']],
  ['--text-muted', 3.0, ['--bg-primary']],
  // The status bar paints its background with --statusbar-bg (default accent),
  // so its text must contrast against that, not the editor background.
  ['--statusbar-text', 4.5, ['--statusbar-bg', '--accent']],
];

function tryParseHex(v: string | undefined): [number, number, number] | null {
  if (!v) return null;
  try { return parseHexColor(v); } catch { return null; }
}

/**
 * Return a copy of `vars` with text colors nudged toward white/black so they
 * stay readable against the theme's `--bg-primary` — guarantees legible text
 * for every theme (built-in or custom). Only adjusts hex colors when a hex
 * `--bg-primary` is present and a text color falls below its target; other
 * values (and non-hex expressions) pass through untouched.
 */
function enforceReadableText(vars: Record<string, string>): Record<string, string> {
  let out: Record<string, string> | null = null;
  for (const [key, target, bgKeys] of TEXT_CONTRAST_TARGETS) {
    let bg: [number, number, number] | null = null;
    for (const bk of bgKeys) { bg = tryParseHex(vars[bk]); if (bg) break; }
    const fg = tryParseHex(vars[key]);
    if (!bg || !fg || contrastRatio(fg, bg) >= target) continue;
    const fixed = toHexColor(adjustColorForContrast(fg, bg, target));
    out = out ?? { ...vars };
    out[key] = fixed;
  }
  return out ?? vars;
}

/**
 * Apply a custom theme's variables as inline overrides on the document root.
 * Clears all theme vars first so switching/removing a theme never leaks stale
 * values; unset vars fall back to the built-in dark/light values in app.css.
 */
export function applyCustomThemeVars(theme: CustomTheme | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const v of THEME_VARS) root.style.removeProperty(v);
  if (theme) {
    const vars = enforceReadableText(theme.vars);
    for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
  }
}

/**
 * Apply the active theme's full IDE palette: a selected custom theme wins,
 * otherwise the built-in chrome palette for the given editor theme. Reuses
 * applyCustomThemeVars so switching always clears stale overrides.
 */
export function applyActiveTheme(editorThemeId: string): void {
  const id = get(activeCustomThemeId);
  if (id) {
    applyCustomThemeVars(get(customThemes).find(t => t.id === id) ?? null);
    return;
  }
  const vars = builtinThemeVars(editorThemeId as EditorThemeId);
  applyCustomThemeVars(vars ? { id: editorThemeId, name: editorThemeId, vars } : null);
}
