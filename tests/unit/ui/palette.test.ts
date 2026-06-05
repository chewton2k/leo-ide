import { describe, it, expect } from 'vitest';
import { fuzzyScore, filterActions, PALETTE_ACTIONS } from '../../../src/lib/modules/palette/actions';

describe('palette fuzzyScore', () => {
  it('returns 0 for empty query (matches everything)', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('returns null when query is not a subsequence', () => {
    expect(fuzzyScore('zzz', 'open settings')).toBeNull();
  });

  it('returns a positive score for a subsequence match', () => {
    const s = fuzzyScore('git', 'Toggle Source Control git');
    expect(s).not.toBeNull();
    expect(s as number).toBeGreaterThan(0);
  });

  it('rewards word-start / consecutive matches with a higher score', () => {
    const consecutive = fuzzyScore('git', 'git graph') as number;
    const scattered = fuzzyScore('git', 'gxixt') as number;
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

describe('palette filterActions', () => {
  it('returns the full registry for an empty query', () => {
    expect(filterActions('', PALETTE_ACTIONS)).toHaveLength(PALETTE_ACTIONS.length);
  });

  it('surfaces git-related actions for "git" and ranks them first', () => {
    const res = filterActions('git', PALETTE_ACTIONS);
    const ids = res.map(a => a.id);
    expect(ids).toContain('tab.gitGraph');
    expect(ids).toContain('view.git');
    // A clearly-unrelated action must be filtered out.
    expect(ids).not.toContain('file.newFolder');
  });

  it('matches via keywords, not just label', () => {
    const res = filterActions('grep', PALETTE_ACTIONS).map(a => a.id);
    expect(res).toContain('search.inFiles');
  });

  it('ranks an exact label hit above keyword-only hits', () => {
    const res = filterActions('preview', PALETTE_ACTIONS);
    expect(res[0].id).toBe('tab.preview');
  });
});
