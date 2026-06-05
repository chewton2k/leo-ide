// ── Appearance mode (IDE chrome) ─────────────────────────────────
export type AppearanceMode = 'system' | 'light' | 'dark';

// ── Editor themes (CodeMirror) ───────────────────────────────────
export const EDITOR_THEMES = [
  'one-dark',
  'github-dark',
  'tokyo-night',
  'nord',
  'catppuccin-mocha',
  'plum-dark',
  'github-light',
  'catppuccin-latte',
  'solarized-light',
  'plum-light',
] as const;

export type EditorThemeId = (typeof EDITOR_THEMES)[number];

export const EDITOR_THEME_LABELS: Record<EditorThemeId, string> = {
  'one-dark': 'One Dark',
  'github-dark': 'GitHub Dark',
  'tokyo-night': 'Tokyo Night',
  'nord': 'Nord',
  'catppuccin-mocha': 'Catppuccin Mocha',
  'plum-dark': 'Plum Dark',
  'github-light': 'GitHub Light',
  'catppuccin-latte': 'Catppuccin Latte',
  'solarized-light': 'Solarized Light',
  'plum-light': 'Plum Light',
};

/** Returns true if the given editor theme is a light theme */
export function isLightEditorTheme(id: EditorThemeId): boolean {
  return id === 'github-light' || id === 'catppuccin-latte' || id === 'solarized-light' || id === 'plum-light';
}

/**
 * Built-in themes shown in the unified Themes grid. Each pairs an editor
 * (CodeMirror) syntax theme with its base light/dark appearance, plus a few
 * representative swatches for the card preview.
 */
export interface BuiltinTheme { id: EditorThemeId; name: string; light: boolean; swatches: string[]; }

export const BUILTIN_THEMES: BuiltinTheme[] = [
  { id: 'one-dark',         name: 'One Dark',         light: false, swatches: ['#282c34', '#61afef', '#98c379', '#c678dd'] },
  { id: 'github-dark',      name: 'GitHub Dark',      light: false, swatches: ['#0d1117', '#58a6ff', '#7ee787', '#ff7b72'] },
  { id: 'tokyo-night',      name: 'Tokyo Night',      light: false, swatches: ['#1a1b26', '#7aa2f7', '#9ece6a', '#bb9af7'] },
  { id: 'nord',             name: 'Nord',             light: false, swatches: ['#2e3440', '#88c0d0', '#a3be8c', '#b48ead'] },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', light: false, swatches: ['#1e1e2e', '#89b4fa', '#a6e3a1', '#f5c2e7'] },
  { id: 'plum-dark',        name: 'Plum Dark',        light: false, swatches: ['#282c34', '#61afef', '#98c379', '#c678dd'] },
  { id: 'github-light',     name: 'GitHub Light',     light: true,  swatches: ['#ffffff', '#0969da', '#1a7f37', '#cf222e'] },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', light: true,  swatches: ['#eff1f5', '#1e66f5', '#40a02b', '#ea76cb'] },
  { id: 'solarized-light',  name: 'Solarized Light',  light: true,  swatches: ['#fdf6e3', '#268bd2', '#859900', '#d33682'] },
  { id: 'plum-light',       name: 'Plum Light',       light: true,  swatches: ['#faf5fb', '#8e4ea3', '#2f8f7f', '#b5497f'] },
];


// A small per-theme seed expands into the complete leo CSS-var set so
// selecting a built-in theme recolors the entire IDE, not just the editor.
export interface ThemeSeed {
  bg: string; bg2: string; bg3: string; surface: string;
  text: string; text2: string; muted: string;
  accent: string; border: string;
  success: string; warning: string; error: string;
}

export function paletteFromSeed(s: ThemeSeed): Record<string, string> {
  return {
    '--bg-primary': s.bg, '--bg-secondary': s.bg2, '--bg-tertiary': s.bg3, '--bg-surface': s.surface,
    '--text-primary': s.text, '--text-secondary': s.text2, '--text-muted': s.muted,
    '--accent': s.accent, '--accent-hover': `color-mix(in srgb, ${s.accent} 78%, #ffffff)`,
    '--border': s.border, '--success': s.success, '--warning': s.warning, '--error': s.error,
    '--tab-active': s.bg, '--tab-inactive': s.bg2, '--diff-add': s.success, '--diff-del': s.error,
    '--git-graph-accent': s.accent, '--git-notification': s.success, '--statusbar-text': s.text2,
    '--statusbar-bg': s.accent,
    '--settings-icon': s.accent, '--cursor': s.accent, '--gutter': s.muted,
    '--selection': `color-mix(in srgb, ${s.accent} 28%, transparent)`,
    '--line-highlight': `color-mix(in srgb, ${s.text} 7%, transparent)`,
    // Syntax highlighting (editor). Seed-derived defaults for custom themes;
    // built-ins override these with their curated palette (see THEME_SYNTAX).
    '--syntax-keyword': s.accent, '--syntax-string': s.success, '--syntax-comment': s.muted,
    '--syntax-function': s.accent, '--syntax-variable': s.text, '--syntax-number': s.warning,
    '--syntax-type': s.success, '--syntax-operator': s.text2,
  };
}

const THEME_SEEDS: Record<EditorThemeId, ThemeSeed> = {
  'one-dark':         { bg: '#282c34', bg2: '#21252b', bg3: '#1b1f23', surface: '#2c313a', text: '#abb2bf', text2: '#9da5b4', muted: '#5c6370', accent: '#61afef', border: '#3e4451', success: '#98c379', warning: '#e5c07b', error: '#e06c75' },
  'github-dark':      { bg: '#0d1117', bg2: '#010409', bg3: '#010409', surface: '#161b22', text: '#c9d1d9', text2: '#b1bac4', muted: '#8b949e', accent: '#58a6ff', border: '#30363d', success: '#3fb950', warning: '#d29922', error: '#f85149' },
  'tokyo-night':      { bg: '#1a1b26', bg2: '#16161e', bg3: '#13131a', surface: '#1f2335', text: '#c0caf5', text2: '#a9b1d6', muted: '#565f89', accent: '#7aa2f7', border: '#29304d', success: '#9ece6a', warning: '#e0af68', error: '#f7768e' },
  'nord':             { bg: '#2e3440', bg2: '#2b303b', bg3: '#272c36', surface: '#3b4252', text: '#d8dee9', text2: '#c0c8d6', muted: '#7b88a1', accent: '#88c0d0', border: '#434c5e', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a' },
  'catppuccin-mocha': { bg: '#1e1e2e', bg2: '#181825', bg3: '#11111b', surface: '#313244', text: '#cdd6f4', text2: '#bac2de', muted: '#7f849c', accent: '#89b4fa', border: '#45475a', success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8' },
  'plum-dark':        { bg: '#282c34', bg2: '#21252b', bg3: '#1b1f23', surface: '#2c313a', text: '#abb2bf', text2: '#9da5b4', muted: '#5c6370', accent: '#61afef', border: '#3e4451', success: '#98c379', warning: '#e5c07b', error: '#e06c75' },
  'github-light':     { bg: '#ffffff', bg2: '#f6f8fa', bg3: '#eaeef2', surface: '#ffffff', text: '#1f2328', text2: '#424a53', muted: '#656d76', accent: '#0969da', border: '#d0d7de', success: '#1a7f37', warning: '#9a6700', error: '#cf222e' },
  'catppuccin-latte': { bg: '#eff1f5', bg2: '#e6e9ef', bg3: '#dce0e8', surface: '#ffffff', text: '#4c4f69', text2: '#5c5f77', muted: '#8c8fa1', accent: '#1e66f5', border: '#ccd0da', success: '#40a02b', warning: '#df8e1d', error: '#d20f39' },
  'solarized-light':  { bg: '#fdf6e3', bg2: '#eee8d5', bg3: '#e7e0cb', surface: '#fdf6e3', text: '#586e75', text2: '#657b83', muted: '#93a1a1', accent: '#268bd2', border: '#ddd6c1', success: '#859900', warning: '#b58900', error: '#dc322f' },
  'plum-light':       { bg: '#faf5fb', bg2: '#f2e9f4', bg3: '#ece0ef', surface: '#ffffff', text: '#3a2d42', text2: '#5a4a63', muted: '#8a7a93', accent: '#8e4ea3', border: '#e0d2e6', success: '#2f8f7f', warning: '#b5803f', error: '#b5497f' },
};

/** Full leo CSS-var palette for a built-in theme id, or null if unknown. */
/** Curated syntax-highlight palette per built-in theme (matches the editor's
 *  HighlightStyle). Exposed as `--syntax-*` so built-ins keep their exact look
 *  while custom themes can override these colors. */
export interface SyntaxColors {
  keyword: string; string: string; comment: string; function: string;
  variable: string; number: string; type: string; operator: string;
}

export const THEME_SYNTAX: Record<EditorThemeId, SyntaxColors> = {
  'one-dark':         { keyword: '#c678dd', string: '#98c379', comment: '#5c6370', function: '#61afef', variable: '#abb2bf', number: '#d19a66', type: '#e5c07b', operator: '#56b6c2' },
  'github-dark':      { keyword: '#ff7b72', string: '#a5d6ff', comment: '#8b949e', function: '#d2a8ff', variable: '#e6edf3', number: '#79c0ff', type: '#79c0ff', operator: '#ff7b72' },
  'tokyo-night':      { keyword: '#bb9af7', string: '#9ece6a', comment: '#565f89', function: '#7aa2f7', variable: '#c0caf5', number: '#ff9e64', type: '#2ac3de', operator: '#89ddff' },
  'nord':             { keyword: '#81a1c1', string: '#a3be8c', comment: '#616e88', function: '#88c0d0', variable: '#d8dee9', number: '#b48ead', type: '#8fbcbb', operator: '#81a1c1' },
  'catppuccin-mocha': { keyword: '#cba6f7', string: '#a6e3a1', comment: '#6c7086', function: '#89b4fa', variable: '#cdd6f4', number: '#fab387', type: '#94e2d5', operator: '#89dceb' },
  'plum-dark':        { keyword: '#c678dd', string: '#98c379', comment: '#5c6370', function: '#61afef', variable: '#abb2bf', number: '#d19a66', type: '#e5c07b', operator: '#56b6c2' },
  'github-light':     { keyword: '#cf222e', string: '#0a3069', comment: '#6e7781', function: '#8250df', variable: '#24292e', number: '#0550ae', type: '#0550ae', operator: '#cf222e' },
  'catppuccin-latte': { keyword: '#8839ef', string: '#40a02b', comment: '#8c8fa1', function: '#1e66f5', variable: '#4c4f69', number: '#fe640b', type: '#179299', operator: '#04a5e5' },
  'solarized-light':  { keyword: '#859900', string: '#2aa198', comment: '#93a1a1', function: '#268bd2', variable: '#657b83', number: '#d33682', type: '#b58900', operator: '#859900' },
  'plum-light':       { keyword: '#7A3A6A', string: '#4A6B3E', comment: '#8A7E6A', function: '#7A5A14', variable: '#2A2018', number: '#8A4A1E', type: '#6E3E1A', operator: '#5E5346' },
};

function syntaxVars(s: SyntaxColors): Record<string, string> {
  return {
    '--syntax-keyword': s.keyword, '--syntax-string': s.string, '--syntax-comment': s.comment,
    '--syntax-function': s.function, '--syntax-variable': s.variable, '--syntax-number': s.number,
    '--syntax-type': s.type, '--syntax-operator': s.operator,
  };
}

/**
 * Per-theme overrides applied on top of the seed-derived palette, for the few
 * vars a theme intentionally sets differently from the seed formulas (e.g. a
 * dark status bar instead of the default accent-colored one).
 */
const THEME_VAR_OVERRIDES: Partial<Record<EditorThemeId, Record<string, string>>> = {
  'plum-dark': {
    '--statusbar-bg': '#21252b',
    '--tab-inactive': '#1b1f23',
  },
};

export function builtinThemeVars(id: EditorThemeId): Record<string, string> | null {
  const seed = THEME_SEEDS[id];
  if (!seed) return null;
  // Built-ins use their curated syntax palette (keeps the editor's look exact);
  // the seed-derived syntax defaults from paletteFromSeed are overridden here,
  // then any explicit per-theme var overrides are applied last.
  return { ...paletteFromSeed(seed), ...syntaxVars(THEME_SYNTAX[id]), ...(THEME_VAR_OVERRIDES[id] ?? {}) };
}
