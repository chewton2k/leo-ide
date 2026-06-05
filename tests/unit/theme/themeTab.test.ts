import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { themeTabPath, isThemeTabPath, getThemeTabId, openThemeTab, closeThemeTab, openThemeTabs } from '../../../src/lib/modules/theme/themeTab';
import { starterCustomTheme } from '../../../src/lib/modules/theme/customThemes';
import { THEME_VARS, isColor } from '../../../src/lib/modules/theme/validateTheme';

describe('theme tab sentinel', () => {
  it('round-trips an id through the sentinel path', () => {
    const p = themeTabPath('my-theme-abc');
    expect(isThemeTabPath(p)).toBe(true);
    expect(getThemeTabId(p)).toBe('my-theme-abc');
  });
  it('rejects non-theme paths', () => {
    expect(isThemeTabPath('/src/main.ts')).toBe(false);
    expect(isThemeTabPath(null)).toBe(false);
  });
});

describe('openThemeTabs', () => {
  it('opens without duplicates and closes', () => {
    openThemeTab('a');
    openThemeTab('a');
    openThemeTab('b');
    expect(get(openThemeTabs)).toEqual(['a', 'b']);
    closeThemeTab('a');
    expect(get(openThemeTabs)).toEqual(['b']);
    closeThemeTab('b');
  });
});

describe('starterCustomTheme', () => {
  it('produces a valid custom theme with color vars', () => {
    const t = starterCustomTheme();
    expect(t.id).toMatch(/^my-theme-/);
    expect(t.name.length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(t.vars)) {
      expect((THEME_VARS as readonly string[]).includes(k)).toBe(true);
      expect(isColor(v)).toBe(true);
    }
  });
});
