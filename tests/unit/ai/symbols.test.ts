import { describe, it, expect } from 'vitest';
import { extractSymbolsFromSource } from '$lib/modules/ai/symbols';

function byName(src: string, ext: string) {
  const syms = extractSymbolsFromSource(src, ext);
  const map = new Map(syms.map((s) => [s.name, s]));
  return { syms, map, names: syms.map((s) => s.name) };
}

describe('extractSymbolsFromSource', () => {
  it('returns [] for unsupported extensions', () => {
    expect(extractSymbolsFromSource('whatever', 'txt')).toEqual([]);
    expect(extractSymbolsFromSource('whatever', '')).toEqual([]);
  });

  it('extracts JS functions, classes, and methods', () => {
    const src = `export function greet(name) {
  return "hello " + name;
}

class Animal {
  speak() {
    return "some noise";
  }
}
`;
    const { map, names } = byName(src, 'js');
    expect(names).toContain('greet');
    expect(names).toContain('Animal');
    expect(names).toContain('speak');
    expect(map.get('greet')?.kind).toBe('function');
    expect(map.get('Animal')?.kind).toBe('class');
    expect(map.get('speak')?.kind).toBe('method');
    // Line numbers are 1-based.
    expect(map.get('greet')?.start_line).toBe(1);
  });

  it('extracts TS interfaces and type aliases', () => {
    const src = `interface User {
  id: number;
  name: string;
}

type Identifier = string | number;

function load(): void {
  return;
}
`;
    const { map, names } = byName(src, 'ts');
    expect(names).toContain('User');
    expect(names).toContain('Identifier');
    expect(names).toContain('load');
    expect(map.get('User')?.kind).toBe('interface');
    expect(map.get('Identifier')?.kind).toBe('type');
    expect(map.get('load')?.kind).toBe('function');
  });

  it('extracts Python functions and classes', () => {
    const src = `def compute(x):
    return x * 2

class Widget:
    def render(self):
        return None
`;
    const { map, names } = byName(src, 'py');
    expect(names).toContain('compute');
    expect(names).toContain('Widget');
    expect(names).toContain('render');
    expect(map.get('compute')?.kind).toBe('function');
    expect(map.get('Widget')?.kind).toBe('class');
  });

  it('extracts Rust functions, structs, enums, and traits', () => {
    const src = `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

struct Point {
    x: i32,
    y: i32,
}

enum Color {
    Red,
    Green,
}

trait Draw {
    fn draw(&self);
}
`;
    const { map, names } = byName(src, 'rs');
    expect(names).toContain('add');
    expect(names).toContain('Point');
    expect(names).toContain('Color');
    expect(names).toContain('Draw');
    expect(map.get('add')?.kind).toBe('function');
    expect(map.get('Point')?.kind).toBe('struct');
    expect(map.get('Color')?.kind).toBe('enum');
    expect(map.get('Draw')?.kind).toBe('trait');
  });

  it('captures the full body and end line of a multi-line function', () => {
    const src = `function multi() {
  const a = 1;
  const b = 2;
  return a + b;
}
`;
    const { map } = byName(src, 'js');
    const fn = map.get('multi');
    expect(fn).toBeDefined();
    expect(fn?.start_line).toBe(1);
    expect(fn?.end_line).toBe(5);
    expect(fn?.body).toContain('return a + b;');
  });
});
