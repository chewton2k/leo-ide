/** A terminal split-pane tree node (mirrors Terminal.svelte's local type). */
export type SplitNode =
  | { type: 'leaf'; paneId: number }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: [SplitNode, SplitNode] };

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
