import { describe, it, expect } from 'vitest';
import { DormantRing } from '../../../src/lib/modules/terminal/dormantRing';
import { RendererPool } from '../../../src/lib/modules/terminal/rendererPool';

describe('DormantRing', () => {
  it('drains buffered chunks in order, then clears', () => {
    const r = new DormantRing(100);
    r.push('a'); r.push('b'); r.push('c');
    expect(r.size).toBe(3);
    expect(r.drain()).toBe('abc');
    expect(r.size).toBe(0);
    expect(r.drain()).toBe('');
  });
  it('drops oldest chunks on overflow', () => {
    const r = new DormantRing(5);
    r.push('aaa'); r.push('bbb'); // 'aaa' dropped -> 'bbb'
    expect(r.drain()).toBe('bbb');
  });
  it('trims a single oversized chunk to its tail', () => {
    const r = new DormantRing(3);
    r.push('abcdef');
    expect(r.drain()).toBe('def');
  });
  it('ignores empty pushes and clears', () => {
    const r = new DormantRing();
    r.push(''); expect(r.size).toBe(0);
    r.push('x'); r.clear(); expect(r.size).toBe(0);
  });
});

describe('RendererPool', () => {
  it('acquires without eviction under the cap', () => {
    const p = new RendererPool(3);
    expect(p.acquire(1)).toBeNull();
    expect(p.acquire(2)).toBeNull();
    expect(p.size).toBe(2);
    expect(p.has(1)).toBe(true);
  });
  it('evicts the least-recently-used when over the cap', () => {
    const p = new RendererPool(2);
    p.acquire(1); p.acquire(2);
    expect(p.acquire(3)).toBe(1); // 1 was LRU
    expect(p.held()).toEqual([2, 3]);
  });
  it('re-acquiring a held id just bumps it (no eviction)', () => {
    const p = new RendererPool(2);
    p.acquire(1); p.acquire(2);
    expect(p.acquire(1)).toBeNull();      // 1 now MRU
    expect(p.acquire(3)).toBe(2);         // 2 is now LRU, evicted
    expect(p.held()).toEqual([1, 3]);
  });
  it('touch reorders recency; release removes', () => {
    const p = new RendererPool(2);
    p.acquire(1); p.acquire(2);
    p.touch(1);                            // 1 MRU
    expect(p.acquire(3)).toBe(2);
    p.release(3);
    expect(p.has(3)).toBe(false);
    expect(p.size).toBe(1);
  });
});

describe('RendererPool — terminal usage flow (cap=5)', () => {
  it('opening up to 5 panes never evicts; the 6th evicts the oldest', () => {
    const p = new RendererPool(5);
    for (let id = 1; id <= 5; id++) expect(p.acquire(id)).toBeNull();
    expect(p.acquire(6)).toBe(1);          // pane 1 (LRU) loses its WebGL
    expect(p.held()).toEqual([2, 3, 4, 5, 6]);
  });

  it('closing a pane frees a slot so the next open does not evict', () => {
    const p = new RendererPool(5);
    for (let id = 1; id <= 5; id++) p.acquire(id);
    p.release(3);                          // a pane was closed
    expect(p.acquire(7)).toBeNull();       // room again — no eviction
    expect(p.size).toBe(5);
    expect(p.has(3)).toBe(false);
  });

  it('re-acquiring a visible pane keeps it from being the next evicted', () => {
    const p = new RendererPool(5);
    for (let id = 1; id <= 5; id++) p.acquire(id);
    p.acquire(1);                          // pane 1 re-focused -> now MRU
    expect(p.acquire(6)).toBe(2);          // pane 2 is now the LRU, evicted (not 1)
  });
});
