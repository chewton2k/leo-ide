import { describe, it, expect } from 'vitest';
import { parseVersion, isNewer } from '../../../src/lib/modules/updater/updater';

describe('parseVersion', () => {
  it('strips a leading v and pre-release suffix', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('2.0.0-beta.1')).toEqual([2, 0, 0]);
  });
  it('coerces non-numeric segments to 0', () => {
    expect(parseVersion('1.x.3')).toEqual([1, 0, 3]);
  });
});

describe('isNewer', () => {
  it('detects a strictly newer remote', () => {
    expect(isNewer('1.2.4', '1.2.3')).toBe(true);
    expect(isNewer('1.3.0', '1.2.9')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
  });
  it('is false for equal or older remote', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isNewer('1.2.2', '1.2.3')).toBe(false);
    expect(isNewer('0.9.0', '1.0.0')).toBe(false);
  });
  it('handles differing segment counts and v-prefix', () => {
    expect(isNewer('v1.2', '1.2.0')).toBe(false);
    expect(isNewer('1.2.1', 'v1.2')).toBe(true);
  });
});
