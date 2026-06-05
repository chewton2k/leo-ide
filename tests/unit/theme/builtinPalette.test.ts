import { describe, it, expect, beforeEach } from 'vitest';
import { paletteFromSeed, builtinThemeVars, BUILTIN_THEMES } from '../../../src/lib/modules/theme/themes';
import { THEME_VARS, isColor } from '../../../src/lib/modules/theme/validateTheme';
import { applyActiveTheme } from '../../../src/lib/modules/theme/applyTheme';
import { activeCustomThemeId } from '../../../src/lib/modules/theme/customThemes';

const SEED = {
  bg: '#1a1b26', bg2: '#16161e', bg3: '#13131a', surface: '#1f2335',
  text: '#c0caf5', text2: '#a9b1d6', muted: '#565f89',
  accent: '#7aa2f7', border: '#29304d',
  success: '#9ece6a', warning: '#e0af68', error: '#f7768e',
};

describe('paletteFromSeed', () => {
  it('produces a value for every themeable variable', () => {
    const p = paletteFromSeed(SEED);
    for (const v of THEME_VARS) {
      expect(p[v], `missing ${v}`).toBeTruthy();
      expect(isColor(p[v]), `${v}=${p[v]} not a color`).toBe(true);
    }
  });

  it('maps seed colors onto the matching core variables', () => {
    const p = paletteFromSeed(SEED);
    expect(p['--bg-primary']).toBe('#1a1b26');
    expect(p['--accent']).toBe('#7aa2f7');
    expect(p['--error']).toBe('#f7768e');
  });
});

describe('builtinThemeVars', () => {
  it('returns a full valid palette for every built-in theme', () => {
    for (const b of BUILTIN_THEMES) {
      const vars = builtinThemeVars(b.id);
      expect(vars, `no palette for ${b.id}`).toBeTruthy();
      for (const v of THEME_VARS) expect(isColor(vars![v]), `${b.id} ${v}`).toBe(true);
    }
  });

  it('returns null for an unknown id', () => {
    expect(builtinThemeVars('does-not-exist' as never)).toBeNull();
  });
});

describe('applyActiveTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    activeCustomThemeId.set('');
  });

  it('applies the built-in chrome palette when no custom theme is active', () => {
    applyActiveTheme('nord');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#2e3440');
  });

  it('clears overrides for an unknown editor theme with no custom theme', () => {
    applyActiveTheme('nord');
    applyActiveTheme('totally-unknown');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('');
  });
});
