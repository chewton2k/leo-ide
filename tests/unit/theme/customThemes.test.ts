import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { validateThemeObject, parseTheme, isColor } from '../../../src/lib/modules/theme/validateTheme';

const good = { id: 'midnight', name: 'Midnight', vars: { '--bg-primary': '#101018', '--accent': '#5b8' } };

describe('isColor', () => {
  it('accepts hex and functional colors', () => {
    expect(isColor('#fff')).toBe(true);
    expect(isColor('#1a2b3c')).toBe(true);
    expect(isColor('rgb(10, 20, 30)')).toBe(true);
    expect(isColor('color-mix(in srgb, #fff 50%, #000)')).toBe(true);
  });
  it('rejects non-colors', () => {
    expect(isColor('reddish')).toBe(false);
    expect(isColor('123')).toBe(false);
    expect(isColor('')).toBe(false);
  });
});

describe('validateThemeObject', () => {
  it('accepts a well-formed theme', () => {
    const r = validateThemeObject(good);
    expect(r.ok).toBe(true);
  });
  it('rejects a non-object', () => {
    expect(validateThemeObject(null).ok).toBe(false);
    expect(validateThemeObject('x').ok).toBe(false);
  });
  it('requires id and name', () => {
    expect(validateThemeObject({ name: 'x', vars: { '--accent': '#fff' } }).ok).toBe(false);
    expect(validateThemeObject({ id: 'x', vars: { '--accent': '#fff' } }).ok).toBe(false);
  });
  it('rejects unknown variable keys', () => {
    const r = validateThemeObject({ id: 'x', name: 'X', vars: { '--not-real': '#fff' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown variable/);
  });
  it('rejects non-color values', () => {
    const r = validateThemeObject({ id: 'x', name: 'X', vars: { '--accent': 'banana' } });
    expect(r.ok).toBe(false);
  });
  it('rejects empty vars', () => {
    expect(validateThemeObject({ id: 'x', name: 'X', vars: {} }).ok).toBe(false);
  });
});

describe('parseTheme', () => {
  it('reports invalid JSON', () => {
    const r = parseTheme('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/);
  });
  it('parses + validates valid JSON', () => {
    expect(parseTheme(JSON.stringify(good)).ok).toBe(true);
  });
});

describe('customThemes CRUD', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('saves, replaces by id, lists, gets, and deletes', async () => {
    const m = await import('../../../src/lib/modules/theme/customThemes');
    expect(m.listCustomThemes()).toEqual([]);

    m.saveCustomTheme({ id: 'a', name: 'A', vars: { '--accent': '#111' } });
    m.saveCustomTheme({ id: 'b', name: 'B', vars: { '--accent': '#222' } });
    expect(m.listCustomThemes()).toHaveLength(2);

    // Replace by id (not duplicate).
    m.saveCustomTheme({ id: 'a', name: 'A2', vars: { '--accent': '#333' } });
    expect(m.listCustomThemes()).toHaveLength(2);
    expect(m.getCustomTheme('a')?.name).toBe('A2');

    // Persisted to localStorage.
    expect(JSON.parse(localStorage.getItem('leo-custom-themes')!)).toHaveLength(2);

    m.deleteCustomTheme('a');
    expect(m.getCustomTheme('a')).toBeUndefined();
    expect(get(m.customThemes)).toHaveLength(1);
  });

  it('clears active id when the active theme is deleted', async () => {
    const m = await import('../../../src/lib/modules/theme/customThemes');
    m.saveCustomTheme({ id: 'a', name: 'A', vars: { '--accent': '#111' } });
    m.activeCustomThemeId.set('a');
    m.deleteCustomTheme('a');
    expect(get(m.activeCustomThemeId)).toBe('');
  });
});

describe('copyThemeToCustom', () => {
  it('copies vars, suffixes the name, and assigns a fresh id', async () => {
    const m = await import('../../../src/lib/modules/theme/customThemes');
    const source = { name: 'Plum Dark', vars: { '--bg-primary': '#282c34', '--accent': '#7aa2f7' } };
    const copy = m.copyThemeToCustom(source);

    expect(copy.name).toBe('Plum Dark (copy)');
    expect(copy.id).toMatch(/^my-theme-/);
    expect(copy.vars).toEqual(source.vars);
  });

  it('clones the vars object so editing the copy never mutates the source', async () => {
    const m = await import('../../../src/lib/modules/theme/customThemes');
    const source = { name: 'X', vars: { '--accent': '#111' } };
    const copy = m.copyThemeToCustom(source);
    copy.vars['--accent'] = '#999';
    expect(source.vars['--accent']).toBe('#111');
  });

  it('gives two copies of the same source distinct ids', async () => {
    const m = await import('../../../src/lib/modules/theme/customThemes');
    const source = { name: 'X', vars: { '--accent': '#111' } };
    expect(m.copyThemeToCustom(source).id).not.toBe(m.copyThemeToCustom(source).id);
  });
});
