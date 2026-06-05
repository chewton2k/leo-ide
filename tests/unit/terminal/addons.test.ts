import { describe, it, expect } from 'vitest';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';

// xterm itself can't run under jsdom, so this is a dependency/wiring smoke
// check: the addon packages resolve and their entry points are constructable.
// The actual find/render behaviour is exercised in the running app.
describe('terminal addons', () => {
  it('SearchAddon constructs and exposes find APIs', () => {
    const s = new SearchAddon();
    expect(typeof s.findNext).toBe('function');
    expect(typeof s.findPrevious).toBe('function');
  });

  it('WebglAddon is a constructor', () => {
    expect(typeof WebglAddon).toBe('function');
  });

  it('SerializeAddon constructs and exposes serialize()', () => {
    const s = new SerializeAddon();
    expect(typeof s.serialize).toBe('function');
  });
});
