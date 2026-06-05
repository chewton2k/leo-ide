import {
  showSettings,
  toggleGitPanel,
  toggleChatPanel,
  toggleFindInFiles,
  openFileSearchSignal,
  createFileSignal,
  createFolderSignal,
} from '../ui/ui';
import { activeFilePath, nextTab, prevTab } from '../explorer/files';
import { GIT_GRAPH_PATH, PREVIEW_PATH, showPreview, showGitGraph } from '../terminal/shell';

export type PaletteGroup = 'General' | 'View' | 'Tabs' | 'Search' | 'File';

export const PALETTE_GROUP_ORDER: readonly PaletteGroup[] = ['General', 'View', 'Search', 'Tabs', 'File'];

export interface PaletteAction {
  id: string;
  label: string;
  group: PaletteGroup;
  keywords?: string[];
  run: () => void;
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: 'view.settings', label: 'Open Settings', group: 'General', keywords: ['preferences', 'config'], run: () => showSettings.set(true) },
  { id: 'view.git', label: 'Toggle Source Control', group: 'View', keywords: ['git', 'scm'], run: () => toggleGitPanel() },
  { id: 'view.chat', label: 'Toggle AI Chat', group: 'View', keywords: ['ai', 'assistant', 'leo'], run: () => toggleChatPanel() },
  { id: 'search.inFiles', label: 'Search in Files', group: 'Search', keywords: ['grep', 'find', 'content'], run: () => toggleFindInFiles() },
  { id: 'search.goToFile', label: 'Go to File', group: 'Search', keywords: ['open', 'quick', 'fuzzy'], run: () => openFileSearchSignal.update(n => n + 1) },
  { id: 'tab.gitGraph', label: 'Open Git Graph', group: 'Tabs', keywords: ['history', 'commits', 'graph'], run: () => { showGitGraph.set(true); activeFilePath.set(GIT_GRAPH_PATH); } },
  { id: 'tab.preview', label: 'Open Web Preview', group: 'Tabs', keywords: ['browser', 'web', 'server'], run: () => { showPreview.set(true); activeFilePath.set(PREVIEW_PATH); } },
  { id: 'tab.next', label: 'Next Tab', group: 'Tabs', keywords: [], run: () => nextTab() },
  { id: 'tab.prev', label: 'Previous Tab', group: 'Tabs', keywords: [], run: () => prevTab() },
  { id: 'file.new', label: 'New File', group: 'File', keywords: ['create'], run: () => createFileSignal.update(n => n + 1) },
  { id: 'file.newFolder', label: 'New Folder', group: 'File', keywords: ['create', 'directory'], run: () => createFolderSignal.update(n => n + 1) },
];

/**
 * Subsequence fuzzy score. Returns null when `query` is not a subsequence of
 * `text`; higher is a better match (rewards consecutive runs and word starts).
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  let prevIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak = prevIdx === ti - 1 ? streak + 1 : 0;
      const wordStart = ti === 0 || /\s/.test(t[ti - 1]) ? 3 : 0;
      score += 1 + streak * 2 + wordStart;
      prevIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

/** Filter + rank actions for a query. Empty query returns all in registry order. */
export function filterActions(query: string, actions: PaletteAction[] = PALETTE_ACTIONS): PaletteAction[] {
  if (!query.trim()) return actions;
  return actions
    .map(a => {
      const labelScore = fuzzyScore(query, a.label);
      const hayScore = fuzzyScore(query, [a.label, ...(a.keywords ?? [])].join(' '));
      const best = labelScore != null ? Math.max(labelScore, hayScore ?? labelScore) : hayScore;
      return best == null ? null : { a, best };
    })
    .filter((x): x is { a: PaletteAction; best: number } => x !== null)
    .sort((x, y) => y.best - x.best)
    .map(x => x.a);
}
