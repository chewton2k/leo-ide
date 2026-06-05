import { describe, it, expect } from 'vitest';
import { parseOsc7, nextInCommand } from '../../../src/lib/modules/terminal/osc';

describe('parseOsc7', () => {
  it('parses file://host/path', () => {
    expect(parseOsc7('file://myhost/Users/me/proj')).toBe('/Users/me/proj');
    expect(parseOsc7('file:///Users/me/proj')).toBe('/Users/me/proj');
  });
  it('percent-decodes the path', () => {
    expect(parseOsc7('file:///Users/me/my%20proj')).toBe('/Users/me/my proj');
  });
  it('strips the leading slash for Windows drive paths', () => {
    expect(parseOsc7('file:///C:/Users/me')).toBe('C:/Users/me');
  });
  it('returns null for non-file or garbage payloads', () => {
    expect(parseOsc7('http://example.com/x')).toBeNull();
    expect(parseOsc7('not a url')).toBeNull();
    expect(parseOsc7('')).toBeNull();
  });
});

describe('nextInCommand', () => {
  it('A (new prompt) and D (command end) clear the in-command flag', () => {
    expect(nextInCommand(true, 'A')).toBe(false);
    expect(nextInCommand(true, 'D;0')).toBe(false);
  });
  it('B and C set the in-command flag', () => {
    expect(nextInCommand(false, 'B')).toBe(true);
    expect(nextInCommand(false, 'C')).toBe(true);
  });
  it('unknown payloads keep the current state', () => {
    expect(nextInCommand(true, 'X')).toBe(true);
    expect(nextInCommand(false, 'X')).toBe(false);
  });
});
