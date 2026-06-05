/** A terminal split-pane tree node (mirrors Terminal.svelte's local type). */
export type SplitNode =
  | { type: 'leaf'; paneId: number }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      /** Stable id so a divider drag can target this split. */
      id?: number;
      /** Fraction (0..1) of the space given to the FIRST child. Default 0.5. */
      ratio?: number;
      children: [SplitNode, SplitNode];
    };

export interface PaneRect { top: number; left: number; width: number; height: number; }

/** A draggable divider between a split's two children. Positions are in
 *  percent of the whole container; `left/top/width/height` describe the
 *  split's own region (used to convert a pointer position back into a ratio). */
export interface SplitHandle {
  id: number;
  direction: 'horizontal' | 'vertical';
  /** Boundary position along the split axis, in percent of the container. */
  pos: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SplitLayout {
  rects: Record<number, PaneRect>;
  handles: SplitHandle[];
}

export function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.5;
  return Math.min(0.9, Math.max(0.1, r));
}

/**
 * Compute every leaf's rectangle and every split's divider handle from the
 * tree, honoring each split's `ratio`. All values are in percent (0–100) of
 * the container so the caller can position panes/handles with `%` styles.
 */
export function computeSplitLayout(tree: SplitNode | null): SplitLayout {
  const rects: Record<number, PaneRect> = {};
  const handles: SplitHandle[] = [];

  function walk(node: SplitNode, top: number, left: number, width: number, height: number) {
    if (node.type === 'leaf') {
      rects[node.paneId] = { top, left, width, height };
      return;
    }
    const r = clampRatio(node.ratio ?? 0.5);
    if (node.direction === 'horizontal') {
      const w0 = width * r;
      walk(node.children[0], top, left, w0, height);
      walk(node.children[1], top, left + w0, width - w0, height);
      if (node.id != null) {
        handles.push({ id: node.id, direction: 'horizontal', pos: left + w0, left, top, width, height });
      }
    } else {
      const h0 = height * r;
      walk(node.children[0], top, left, width, h0);
      walk(node.children[1], top + h0, left, width, height - h0);
      if (node.id != null) {
        handles.push({ id: node.id, direction: 'vertical', pos: top + h0, left, top, width, height });
      }
    }
  }

  if (tree) walk(tree, 0, 0, 100, 100);
  return { rects, handles };
}

/** Return a copy of the tree with the given split's ratio updated (clamped). */
export function setSplitRatio(tree: SplitNode, id: number, ratio: number): SplitNode {
  if (tree.type === 'leaf') return tree;
  if (tree.id === id) return { ...tree, ratio: clampRatio(ratio) };
  const c0 = setSplitRatio(tree.children[0], id, ratio);
  const c1 = setSplitRatio(tree.children[1], id, ratio);
  if (c0 === tree.children[0] && c1 === tree.children[1]) return tree;
  return { ...tree, children: [c0, c1] };
}

function firstLeaf(node: SplitNode): number {
  return node.type === 'leaf' ? node.paneId : firstLeaf(node.children[0]);
}

function containsLeaf(node: SplitNode, paneId: number): boolean {
  return node.type === 'leaf'
    ? node.paneId === paneId
    : node.children.some(c => containsLeaf(c, paneId));
}

/**
 * The closest split sibling of `paneId` — the pane focus should move to when
 * `paneId` is closed. Recurses into the child containing `paneId` so the
 * nearest sibling wins; falls back to the other branch's first leaf. Null if
 * `paneId` isn't in the tree or has no sibling.
 */
export function siblingLeaf(tree: SplitNode | null, paneId: number): number | null {
  if (!tree || tree.type === 'leaf') return null;
  const [a, b] = tree.children;
  if (containsLeaf(a, paneId)) return siblingLeaf(a, paneId) ?? firstLeaf(b);
  if (containsLeaf(b, paneId)) return siblingLeaf(b, paneId) ?? firstLeaf(a);
  return null;
}
