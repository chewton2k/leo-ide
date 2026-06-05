import { describe, it, expect } from 'vitest';
import { shouldFollowCwd } from '../../../src/lib/modules/terminal/shell';

describe('shouldFollowCwd', () => {
  it('re-roots when the terminal reports a new directory', () => {
    expect(shouldFollowCwd('/Users/me', '/Users/me/project')).toBe(true);
    expect(shouldFollowCwd(null, '/Users/me')).toBe(true);
  });

  it('does not re-root when the cwd matches the current root', () => {
    expect(shouldFollowCwd('/Users/me/project', '/Users/me/project')).toBe(false);
  });

  it('does not re-root without a reported cwd', () => {
    expect(shouldFollowCwd('/Users/me', null)).toBe(false);
    expect(shouldFollowCwd(null, null)).toBe(false);
    expect(shouldFollowCwd('/Users/me', '')).toBe(false);
  });
});
