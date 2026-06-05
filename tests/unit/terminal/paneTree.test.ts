import { describe, it, expect } from 'vitest';
import {
  siblingLeaf, computeSplitLayout, setSplitRatio, clampRatio,
  type SplitNode,
} from '../../../src/lib/modules/terminal/paneTree';

const leaf = (paneId: number): SplitNode => ({ type: 'leaf', paneId });
const hsplit = (a: SplitNode, b: SplitNode): SplitNode => ({ type: 'split', direction: 'horizontal', children: [a, b] });

describe('siblingLeaf', () => {
  it('returns null for a single-leaf tree or null tree', () => {
    expect(siblingLeaf(leaf(1), 1)).toBeNull();
    expect(siblingLeaf(null, 1)).toBeNull();
  });

  it('returns the other leaf of a 2-pane split', () => {
    const t = hsplit(leaf(1), leaf(2));
    expect(siblingLeaf(t, 1)).toBe(2);
    expect(siblingLeaf(t, 2)).toBe(1);
  });

  it('returns the closest sibling in a nested split', () => {
    // split[ split[1,2], 3 ]
    const t = hsplit(hsplit(leaf(1), leaf(2)), leaf(3));
    expect(siblingLeaf(t, 1)).toBe(2);   // closest sibling is 2, not 3
    expect(siblingLeaf(t, 2)).toBe(1);
    expect(siblingLeaf(t, 3)).toBe(1);   // sibling subtree is split[1,2] -> first leaf 1
  });

  it('returns null when the pane is not in the tree', () => {
    expect(siblingLeaf(hsplit(leaf(1), leaf(2)), 99)).toBeNull();
  });
});

describe('clampRatio', () => {
  it('clamps to [0.1, 0.9] and defaults NaN to 0.5', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.02)).toBe(0.1);
    expect(clampRatio(0.99)).toBe(0.9);
    expect(clampRatio(Number.NaN)).toBe(0.5);
  });
});

describe('computeSplitLayout', () => {
  it('places a single leaf over the whole container', () => {
    const { rects, handles } = computeSplitLayout(leaf(1));
    expect(rects[1]).toEqual({ top: 0, left: 0, width: 100, height: 100 });
    expect(handles).toHaveLength(0);
  });

  it('splits 50/50 by default with no handle when the split has no id', () => {
    const { rects, handles } = computeSplitLayout(hsplit(leaf(1), leaf(2)));
    expect(rects[1]).toEqual({ top: 0, left: 0, width: 50, height: 100 });
    expect(rects[2]).toEqual({ top: 0, left: 50, width: 50, height: 100 });
    expect(handles).toHaveLength(0); // id is required to emit a handle
  });

  it('honors ratio and emits a handle at the boundary (horizontal)', () => {
    const t: SplitNode = { type: 'split', id: 7, direction: 'horizontal', ratio: 0.3, children: [leaf(1), leaf(2)] };
    const { rects, handles } = computeSplitLayout(t);
    expect(rects[1].width).toBeCloseTo(30);
    expect(rects[2].left).toBeCloseTo(30);
    expect(rects[2].width).toBeCloseTo(70);
    expect(handles).toEqual([{ id: 7, direction: 'horizontal', pos: 30, left: 0, top: 0, width: 100, height: 100 }]);
  });

  it('honors ratio for a vertical split', () => {
    const t: SplitNode = { type: 'split', id: 9, direction: 'vertical', ratio: 0.25, children: [leaf(1), leaf(2)] };
    const { rects, handles } = computeSplitLayout(t);
    expect(rects[1].height).toBeCloseTo(25);
    expect(rects[2].top).toBeCloseTo(25);
    expect(handles[0]).toMatchObject({ id: 9, direction: 'vertical', pos: 25 });
  });

  it('computes nested split rects within the parent region', () => {
    // horizontal[ leaf1, vertical[leaf2, leaf3] ] both 0.5
    const t: SplitNode = {
      type: 'split', id: 1, direction: 'horizontal', ratio: 0.5,
      children: [leaf(1), { type: 'split', id: 2, direction: 'vertical', ratio: 0.5, children: [leaf(2), leaf(3)] }],
    };
    const { rects, handles } = computeSplitLayout(t);
    expect(rects[1]).toEqual({ top: 0, left: 0, width: 50, height: 100 });
    expect(rects[2]).toEqual({ top: 0, left: 50, width: 50, height: 50 });
    expect(rects[3]).toEqual({ top: 50, left: 50, width: 50, height: 50 });
    // inner handle spans only the right half
    const inner = handles.find(h => h.id === 2)!;
    expect(inner).toMatchObject({ direction: 'vertical', pos: 50, left: 50, width: 50 });
  });
});

describe('setSplitRatio', () => {
  it('updates the targeted split and clamps the value', () => {
    const t: SplitNode = { type: 'split', id: 1, direction: 'horizontal', ratio: 0.5, children: [leaf(1), leaf(2)] };
    const updated = setSplitRatio(t, 1, 0.72) as Extract<SplitNode, { type: 'split' }>;
    expect(updated.ratio).toBeCloseTo(0.72);
    expect(setSplitRatio(t, 1, 0.001)).toMatchObject({ ratio: 0.1 });
  });

  it('updates a nested split and leaves the rest unchanged', () => {
    const inner: SplitNode = { type: 'split', id: 2, direction: 'vertical', ratio: 0.5, children: [leaf(2), leaf(3)] };
    const t: SplitNode = { type: 'split', id: 1, direction: 'horizontal', ratio: 0.5, children: [leaf(1), inner] };
    const updated = setSplitRatio(t, 2, 0.3) as Extract<SplitNode, { type: 'split' }>;
    expect((updated.children[1] as Extract<SplitNode, { type: 'split' }>).ratio).toBeCloseTo(0.3);
    expect(updated.ratio).toBe(0.5); // outer untouched
  });

  it('returns the same tree when the id is absent', () => {
    const t: SplitNode = { type: 'split', id: 1, direction: 'horizontal', ratio: 0.5, children: [leaf(1), leaf(2)] };
    expect(setSplitRatio(t, 99, 0.3)).toBe(t);
  });
});
