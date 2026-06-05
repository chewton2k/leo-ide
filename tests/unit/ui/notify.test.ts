import { describe, it, expect } from 'vitest';
import { chooseChannel } from '../../../src/lib/modules/notify/notify';

describe('chooseChannel', () => {
  it('is none when notifications are disabled', () => {
    expect(chooseChannel(false, true)).toBe('none');
    expect(chooseChannel(false, false)).toBe('none');
  });
  it('uses an in-app toast when enabled and focused', () => {
    expect(chooseChannel(true, true)).toBe('toast');
  });
  it('uses an OS notification when enabled and unfocused', () => {
    expect(chooseChannel(true, false)).toBe('os');
  });
});
