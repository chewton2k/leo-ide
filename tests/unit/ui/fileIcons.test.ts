import { describe, it, expect } from 'vitest';
import { collectUsedIconNames, getFileIconName } from '../../../src/lib/modules/explorer/fileIcons';
import vscodeSubset from '../../../src/lib/icons/vscode-icons-subset.json';

describe('collectUsedIconNames', () => {
  const names = collectUsedIconNames();

  it('returns a deduped, vscode-icons-prefixed set', () => {
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(n => n.startsWith('vscode-icons:'))).toBe(true);
  });

  it('includes defaults, special-case ids, and folder-opened variants', () => {
    for (const id of [
      'vscode-icons:default-file',
      'vscode-icons:default-folder',
      'vscode-icons:default-folder-opened',
      'vscode-icons:file-type-testts',
      'vscode-icons:file-type-typescriptdef',
      'vscode-icons:folder-type-src',
      'vscode-icons:folder-type-src-opened',
    ]) {
      expect(names).toContain(id);
    }
  });

  it('covers what getFileIconName actually returns for known inputs', () => {
    expect(names).toContain(getFileIconName('package.json'));
    expect(names).toContain(getFileIconName('main.rs'));
    expect(names).toContain(getFileIconName('src', true));
    expect(names).toContain(getFileIconName('src', true, true));
  });

  it('maps Docker special files (including .dockerignore) to the docker icon', () => {
    expect(getFileIconName('Dockerfile')).toBe('vscode-icons:file-type-docker');
    expect(getFileIconName('.dockerignore')).toBe('vscode-icons:file-type-docker');
    expect(names).toContain(getFileIconName('.dockerignore'));
  });

  it('drift guard: every getFileIconName branch output is in the collected set', () => {
    const set = new Set(names);
    const inputs: Array<[string, boolean, boolean]> = [
      ['package.json', false, false],      // special-file map
      ['main.rs', false, false],           // extension map
      ['weird.unknownext', false, false],  // default-file
      ['.env.local', false, false],        // .env. prefix
      ['a.test.ts', false, false],         // testts
      ['a.spec.js', false, false],         // testjs
      ['types.d.ts', false, false],        // typescriptdef
      ['x.module.css', false, false],      // cssmap
      ['Button.stories.tsx', false, false],// storybook
      ['src', true, false],                // folder map
      ['src', true, true],                 // folder map opened
      ['randomdir', true, false],          // default-folder
      ['randomdir', true, true],           // default-folder-opened
    ];
    for (const [name, isDir, isOpen] of inputs) {
      expect(set.has(getFileIconName(name, isDir, isOpen))).toBe(true);
    }
  });

  it('the bundled vscode-icons subset covers every renderable icon (true offline, no CDN fallback)', () => {
    const have = new Set([
      ...Object.keys((vscodeSubset as { icons: Record<string, unknown> }).icons),
      ...Object.keys((vscodeSubset as { aliases?: Record<string, unknown> }).aliases ?? {}),
    ]);
    const missing = names
      .map(id => id.replace('vscode-icons:', ''))
      .filter(name => !have.has(name));
    expect(missing).toEqual([]);
  });
});
