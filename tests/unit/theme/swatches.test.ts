import { describe, it, expect } from 'vitest';
import { themeSwatches, DARK_PALETTE, LIGHT_PALETTE } from '../../../src/lib/modules/theme/swatches';

describe('themeSwatches', () => {
  it('derives an ordered palette from a full theme', () => {
    const sw = themeSwatches(DARK_PALETTE);
    expect(sw).toHaveLength(6);
    // First swatch is the background, last is the error color.
    expect(sw[0]).toBe('#15121A');
    expect(sw[5]).toBe('#C95A4A');
  });

  it('fills unset keys from the fallback so partial themes still preview', () => {
    const sw = themeSwatches({ '--accent': '#ff0000' }, DARK_PALETTE);
    expect(sw).toHaveLength(6);
    expect(sw).toContain('#ff0000');          // the custom accent
    expect(sw).toContain(DARK_PALETTE['--bg-primary']); // filled from fallback
  });

  it('built-in palettes both yield 6 swatches', () => {
    expect(themeSwatches(LIGHT_PALETTE)).toHaveLength(6);
    expect(themeSwatches(DARK_PALETTE)).toHaveLength(6);
  });
});
