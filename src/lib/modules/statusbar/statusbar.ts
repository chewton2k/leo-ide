import { writable } from 'svelte/store';

/** Active editor cursor position (1-based line/col); null when no file editor. */
export const editorCursor = writable<{ line: number; col: number } | null>(null);

const EXT_LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  svelte: 'Svelte', vue: 'Vue', rs: 'Rust', py: 'Python', go: 'Go', java: 'Java',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#',
  css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', json: 'JSON', jsonc: 'JSON',
  md: 'Markdown', mdx: 'Markdown', toml: 'TOML', yaml: 'YAML', yml: 'YAML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
  sql: 'SQL', php: 'PHP', rb: 'Ruby', xml: 'XML', tex: 'LaTeX', lua: 'Lua', swift: 'Swift',
};

/** Human-readable language for a file path (by extension). */
export function languageLabel(path: string | null): string {
  if (!path) return '';
  const name = path.split(/[\\/]/).pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!ext) return 'Plain Text';
  return EXT_LANG[ext] ?? ext.toUpperCase();
}

export function formatCursor(line: number, col: number): string {
  return `Ln ${line}, Col ${col}`;
}

/** Branch label; collapses detached-HEAD states to a readable token. */
export function branchLabel(branch: string | null | undefined): string {
  if (!branch) return '';
  if (branch === 'HEAD' || branch.startsWith('(')) return 'detached HEAD';
  return branch;
}
