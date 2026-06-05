import { describe, it, expect, beforeEach } from 'vitest';
import { applyCustomThemeVars } from '../../../src/lib/modules/theme/applyTheme';
import { builtinThemeVars, BUILTIN_THEMES } from '../../../src/lib/modules/theme/themes';
import {
  parseHexColor,
  contrastRatio,
  adjustColorForContrast,
  toHexColor,
} from '../../../src/lib/modules/utils/contrast';

describe('adjustColorForContrast', () => {
  it('leaves already-readable colors unchanged', () => {
    const fg: [number, number, number] = [255, 255, 255];
    const bg: [number, number, number] = [0, 0, 0];
    expect(adjustColorForContrast(fg, bg, 4.5)).toEqual(fg);
  });

  it('raises a low-contrast color to meet the target', () => {
    const bg: [number, number, number] = [253, 246, 227]; // solarized-light bg
    const fg: [number, number, number] = [147, 161, 161]; // muted (too faint)
    expect(contrastRatio(fg, bg)).toBeLessThan(3.0);
    const fixed = adjustColorForContrast(fg, bg, 3.0);
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(3.0);
  });

  it('round-trips through hex formatting', () => {
    expect(toHexColor([255, 255, 255])).toBe('#ffffff');
    expect(toHexColor([0, 0, 0])).toBe('#000000');
    expect(parseHexColor(toHexColor([18, 52, 86]))).toEqual([18, 52, 86]);
  });
});

describe('theme text readability', () => {
  beforeEach(() => document.documentElement.removeAttribute('style'));

  for (const b of BUILTIN_THEMES) {
    it(`${b.id}: all text colors are readable against the background`, () => {
      applyCustomThemeVars({ id: b.id, name: b.name, vars: builtinThemeVars(b.id)! });
      const root = document.documentElement;
      const bg = parseHexColor(root.style.getPropertyValue('--bg-primary'));
      const read = (k: string) => parseHexColor(root.style.getPropertyValue(k));
      expect(contrastRatio(read('--text-primary'), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(read('--text-secondary'), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(read('--text-muted'), bg)).toBeGreaterThanOrEqual(3.0);
    });
  }
});
