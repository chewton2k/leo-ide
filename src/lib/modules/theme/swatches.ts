// Representative colors shown as a small preview palette for each theme.
const SWATCH_KEYS = ['--bg-primary', '--bg-surface', '--accent', '--text-primary', '--success', '--error'] as const;

// Built-in palettes (from app.css :root.dark / :root.light) for preview swatches.
export const DARK_PALETTE: Record<string, string> = {
  '--bg-primary': '#15121A', '--bg-surface': '#241E2E', '--accent': '#1C1825',
  '--text-primary': '#E8E2D5', '--success': '#8EA88A', '--error': '#C95A4A',
};
export const LIGHT_PALETTE: Record<string, string> = {
  '--bg-primary': '#F5EFE2', '--bg-surface': '#E2D8C1', '--accent': '#EDE5D2',
  '--text-primary': '#2A2018', '--success': '#4A6B3E', '--error': '#A83A2C',
};

/**
 * Derive an ordered preview palette from a theme's vars. Keys the theme does
 * not define fall back to `fallback` (defaults to the dark palette), so a
 * partial custom theme still renders a sensible swatch row.
 */
export function themeSwatches(vars: Record<string, string>, fallback: Record<string, string> = DARK_PALETTE): string[] {
  return SWATCH_KEYS
    .map(k => vars[k] ?? fallback[k])
    .filter((c): c is string => typeof c === 'string');
}
