import { describe, it, expect } from 'vitest';
import { siblingLeaf, type SplitNode } from '../../../src/lib/modules/terminal/paneTree';

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
