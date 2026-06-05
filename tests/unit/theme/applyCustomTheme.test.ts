import { describe, it, expect, beforeEach } from 'vitest';
import { applyCustomThemeVars } from '../../../src/lib/modules/theme/applyTheme';

describe('applyCustomThemeVars', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('sets the theme variables as inline styles', () => {
    applyCustomThemeVars({ id: 't', name: 'T', vars: { '--accent': '#abcdef', '--bg-primary': '#101010' } });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--accent')).toBe('#abcdef');
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#101010');
  });

  it('clears previously-set theme vars when switching themes', () => {
    applyCustomThemeVars({ id: 'a', name: 'A', vars: { '--accent': '#111111', '--border': '#222222' } });
    applyCustomThemeVars({ id: 'b', name: 'B', vars: { '--accent': '#333333' } });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--accent')).toBe('#333333');
    // --border from theme A must be removed (falls back to app.css).
    expect(root.style.getPropertyValue('--border')).toBe('');
  });

  it('clears all theme vars when applying null', () => {
    applyCustomThemeVars({ id: 'a', name: 'A', vars: { '--accent': '#111111' } });
    applyCustomThemeVars(null);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });
});
