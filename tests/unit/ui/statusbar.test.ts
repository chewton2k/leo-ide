import { describe, it, expect } from 'vitest';
import { languageLabel, formatCursor, branchLabel } from '../../../src/lib/modules/statusbar/statusbar';

describe('languageLabel', () => {
  it('maps known extensions', () => {
    expect(languageLabel('src/App.svelte')).toBe('Svelte');
    expect(languageLabel('a/b/main.rs')).toBe('Rust');
    expect(languageLabel('x.tsx')).toBe('TypeScript');
    expect(languageLabel('readme.md')).toBe('Markdown');
  });
  it('uppercases unknown extensions', () => {
    expect(languageLabel('data.parquet')).toBe('PARQUET');
  });
  it('handles no extension and empty path', () => {
    expect(languageLabel('Makefile')).toBe('Plain Text');
    expect(languageLabel('')).toBe('');
    expect(languageLabel(null)).toBe('');
  });
});

describe('formatCursor', () => {
  it('formats line and column', () => {
    expect(formatCursor(12, 5)).toBe('Ln 12, Col 5');
  });
});

describe('branchLabel', () => {
  it('returns the branch name', () => {
    expect(branchLabel('main')).toBe('main');
    expect(branchLabel('feature/x')).toBe('feature/x');
  });
  it('collapses detached HEAD states', () => {
    expect(branchLabel('HEAD')).toBe('detached HEAD');
    expect(branchLabel('(detached)')).toBe('detached HEAD');
  });
  it('is empty for no branch', () => {
    expect(branchLabel(null)).toBe('');
    expect(branchLabel(undefined)).toBe('');
  });
});
