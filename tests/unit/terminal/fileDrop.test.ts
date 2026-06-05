import { describe, it, expect } from 'vitest';
import { quotePathForShell, buildDropText } from '../../../src/lib/modules/terminal/terminalActions';

describe('quotePathForShell', () => {
  it('single-quotes a plain path', () => {
    expect(quotePathForShell('/Users/me/file.txt')).toBe("'/Users/me/file.txt'");
  });
  it('keeps spaces safe inside single quotes', () => {
    expect(quotePathForShell('/Users/me/my file.txt')).toBe("'/Users/me/my file.txt'");
  });
  it('escapes embedded single quotes', () => {
    expect(quotePathForShell("/tmp/it's mine")).toBe("'/tmp/it'\\''s mine'");
  });
});

describe('buildDropText', () => {
  it('joins multiple quoted paths with spaces', () => {
    expect(buildDropText(['/a b', '/c'])).toBe("'/a b' '/c'");
  });
  it('handles a single path', () => {
    expect(buildDropText(['/x'])).toBe("'/x'");
  });
});
