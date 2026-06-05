import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';

describe('background stores', () => {
  beforeEach(() => {
    localStorage.clear();
    // Fresh module instance so persisted stores re-read the cleared localStorage.
    return import('vitest').then(({ vi }) => vi.resetModules());
  });

  it('expose sane defaults', async () => {
    const m = await import('../../../src/lib/modules/theme/background');
    expect(get(m.bgImageId)).toBe('');
    expect(get(m.bgOpacity)).toBe(15);
    expect(get(m.bgBlur)).toBe(0);
    expect(m.BG_OPACITY_MAX).toBe(50);
    expect(m.BG_BLUR_MAX).toBe(40);
  });

  it('persist changes to localStorage', async () => {
    const m = await import('../../../src/lib/modules/theme/background');
    m.bgOpacity.set(30);
    m.bgBlur.set(8);
    m.bgImageId.set('abc-123');
    expect(localStorage.getItem('leo-bg-opacity')).toBe('30');
    expect(localStorage.getItem('leo-bg-blur')).toBe('8');
    expect(localStorage.getItem('leo-bg-image-id')).toBe('abc-123');
  });

  it('removes the image-id key when cleared (empty string)', async () => {
    const m = await import('../../../src/lib/modules/theme/background');
    m.bgImageId.set('xyz');
    expect(localStorage.getItem('leo-bg-image-id')).toBe('xyz');
    m.bgImageId.set('');
    expect(localStorage.getItem('leo-bg-image-id')).toBeNull();
  });
});
