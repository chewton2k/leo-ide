import { describe, expect, it } from 'vitest';
import { terminalTabLabel } from '../../../src/lib/modules/terminal/shell';

describe('terminalTabLabel (leo tab naming)', () => {
  it('uses the last segment of the cwd', () => {
    expect(terminalTabLabel('/Users/me/projects/leo', 'Terminal 1')).toBe('leo');
  });

  it('falls back when there is no cwd', () => {
    expect(terminalTabLabel(null, 'Terminal 2')).toBe('Terminal 2');
    expect(terminalTabLabel(undefined, 'Terminal 3')).toBe('Terminal 3');
  });

  it('updates as the cwd changes (follows cd)', () => {
    expect(terminalTabLabel('/Users/me/a', 'x')).toBe('a');
    expect(terminalTabLabel('/Users/me/b/c', 'x')).toBe('c');
  });

  it('handles Windows-style separators', () => {
    expect(terminalTabLabel('C:\\Users\\me\\proj', 'x')).toBe('proj');
  });

  it('falls back for the filesystem root', () => {
    expect(terminalTabLabel('/', 'Terminal 1')).toBe('Terminal 1');
  });
});
