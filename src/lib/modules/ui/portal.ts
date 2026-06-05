/**
 * Svelte action that relocates a node to another part of the DOM (default
 * `document.body`).
 *
 * Why this exists: leo's plum theme applies `backdrop-filter` to chrome
 * containers like `.toolbar`. Per the CSS spec, an element with a
 * `backdrop-filter`/`filter`/`transform` becomes the *containing block* for
 * its `position: fixed` descendants — and `.toolbar` is also `overflow: hidden`
 * and only ~36px tall. A fixed popup rendered inside it (the project switcher
 * dropdown, the "+" tab menu, the split menu, the tab context menu) therefore
 * gets re-anchored to the toolbar and clipped to invisibility. Portaling the
 * popup to <body> moves it out of that containing block so `position: fixed`
 * resolves against the viewport again.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = document.body) {
  const dest = (typeof target === 'string' ? document.querySelector(target) : target) ?? document.body;
  dest.appendChild(node);
  return {
    destroy() {
      node.parentNode?.removeChild(node);
    },
  };
}
