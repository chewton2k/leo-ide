export interface CustomTheme {
  id: string;
  name: string;
  vars: Record<string, string>;
}

/** The CSS custom properties a theme may override (from app.css :root.dark). */
export const THEME_VARS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-surface',
  '--text-primary', '--text-secondary', '--text-muted',
  '--accent', '--accent-hover', '--border',
  '--success', '--warning', '--error',
  '--tab-active', '--tab-inactive', '--diff-add', '--diff-del',
  '--git-graph-accent', '--git-notification', '--statusbar-text', '--statusbar-bg',
  '--settings-icon', '--cursor', '--gutter', '--selection', '--line-highlight',
  '--syntax-keyword', '--syntax-string', '--syntax-comment', '--syntax-function',
  '--syntax-variable', '--syntax-number', '--syntax-type', '--syntax-operator',
] as const;

const THEME_VAR_SET = new Set<string>(THEME_VARS);

/** Human-readable label + group for each theme variable (for the visual editor). */
export const THEME_VAR_META: Record<string, { label: string; group: string }> = {
  '--bg-primary':       { label: 'Editor background', group: 'Surfaces' },
  '--bg-secondary':     { label: 'Secondary background', group: 'Surfaces' },
  '--bg-tertiary':      { label: 'Tertiary background', group: 'Surfaces' },
  '--bg-surface':       { label: 'Panels / cards', group: 'Surfaces' },
  '--text-primary':     { label: 'Text', group: 'Text' },
  '--text-secondary':   { label: 'Secondary text', group: 'Text' },
  '--text-muted':       { label: 'Muted text', group: 'Text' },
  '--accent':           { label: 'Accent', group: 'Accents' },
  '--accent-hover':     { label: 'Accent (hover)', group: 'Accents' },
  '--border':           { label: 'Borders', group: 'Surfaces' },
  '--success':          { label: 'Success', group: 'Status' },
  '--warning':          { label: 'Warning', group: 'Status' },
  '--error':            { label: 'Error', group: 'Status' },
  '--tab-active':       { label: 'Active tab', group: 'Tabs' },
  '--tab-inactive':     { label: 'Inactive tab', group: 'Tabs' },
  '--diff-add':         { label: 'Diff added', group: 'Git' },
  '--diff-del':         { label: 'Diff removed', group: 'Git' },
  '--git-graph-accent': { label: 'Git graph accent', group: 'Git' },
  '--git-notification': { label: 'Git notification', group: 'Git' },
  '--statusbar-text':   { label: 'Status bar text', group: 'Status bar' },
  '--statusbar-bg':     { label: 'Status bar background', group: 'Status bar' },
  '--settings-icon':    { label: 'Settings accent', group: 'Accents' },
  '--cursor':           { label: 'Cursor', group: 'Editor' },
  '--gutter':           { label: 'Gutter', group: 'Editor' },
  '--selection':        { label: 'Selection', group: 'Editor' },
  '--line-highlight':   { label: 'Line highlight', group: 'Editor' },
  '--syntax-keyword':   { label: 'Keyword', group: 'Syntax' },
  '--syntax-string':    { label: 'String', group: 'Syntax' },
  '--syntax-comment':   { label: 'Comment', group: 'Syntax' },
  '--syntax-function':  { label: 'Function', group: 'Syntax' },
  '--syntax-variable':  { label: 'Variable', group: 'Syntax' },
  '--syntax-number':    { label: 'Number / constant', group: 'Syntax' },
  '--syntax-type':      { label: 'Type / class', group: 'Syntax' },
  '--syntax-operator':  { label: 'Operator', group: 'Syntax' },
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_RE = /^(rgb|rgba|hsl|hsla|color-mix|var)\(.+\)$/i;

export function isColor(value: string): boolean {
  const s = value.trim();
  return HEX_RE.test(s) || FUNC_RE.test(s);
}

export type ValidateResult =
  | { ok: true; theme: CustomTheme }
  | { ok: false; error: string };

export function validateThemeObject(input: unknown): ValidateResult {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Theme must be a JSON object.' };
  const o = input as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return { ok: false, error: 'Theme needs a non-empty string "id".' };
  if (typeof o.name !== 'string' || !o.name.trim()) return { ok: false, error: 'Theme needs a non-empty string "name".' };
  if (typeof o.vars !== 'object' || o.vars === null) return { ok: false, error: 'Theme needs a "vars" object.' };
  const vars = o.vars as Record<string, unknown>;
  const keys = Object.keys(vars);
  if (keys.length === 0) return { ok: false, error: '"vars" must define at least one variable.' };
  for (const k of keys) {
    if (!THEME_VAR_SET.has(k)) return { ok: false, error: `Unknown variable "${k}". Keys must be leo CSS variables like --bg-primary.` };
    const val = vars[k];
    if (typeof val !== 'string' || !isColor(val)) {
      return { ok: false, error: `"${k}" must be a color (hex, rgb()/hsl(), or color-mix()).` };
    }
  }
  return { ok: true, theme: { id: o.id, name: o.name, vars: vars as Record<string, string> } };
}

export function parseTheme(text: string): ValidateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return validateThemeObject(parsed);
}
