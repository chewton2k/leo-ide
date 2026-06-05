import { describe, it, expect, afterEach } from 'vitest';
import { portal } from '$lib/modules/ui/portal';

/**
 * Regression coverage for the broken project dropdown and "+" tab menu.
 *
 * Root cause: the plum theme puts `backdrop-filter` on `.toolbar`. Per the CSS
 * spec, any element with a `backdrop-filter` (or `filter`/`transform`) becomes
 * the *containing block* for its `position: fixed` descendants. The toolbar is
 * also `overflow: hidden` and only ~36px tall, so a fixed popup rendered inside
 * it is re-anchored to the toolbar and then clipped to nothing — the chevron
 * still animates (state flips) but the panel never visibly drops down.
 *
 * The `portal` action fixes this by relocating the popup to <body>, outside the
 * filtered/clipped ancestor, so `position: fixed` resolves against the viewport
 * again. These tests reproduce that exact DOM trap.
 */

/** Mirrors the plum-theme `.toolbar`: a backdrop-filtered, clipping ancestor. */
function makeFrostedToolbar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.style.cssText = 'backdrop-filter: blur(14px); overflow: hidden; height: 36px;';
  document.body.appendChild(toolbar);
  return toolbar;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('portal action', () => {
  it('frees a fixed popup trapped inside a backdrop-filtered, overflow-hidden ancestor', () => {
    const toolbar = makeFrostedToolbar();
    const popup = document.createElement('div');
    popup.className = 'project-dropdown';
    popup.style.position = 'fixed';
    toolbar.appendChild(popup);

    // Precondition: this is the bug — the popup is a descendant of the
    // backdrop-filtered toolbar, so it is clipped and invisible.
    expect(toolbar.contains(popup)).toBe(true);

    const action = portal(popup);

    // After portaling, the popup is a direct child of <body>, escaping the
    // containing block + overflow:hidden, so it can render against the viewport.
    expect(popup.parentElement).toBe(document.body);
    expect(toolbar.contains(popup)).toBe(false);

    action?.destroy?.();
  });

  it('works for every fixed popup that lived inside the toolbar', () => {
    const toolbar = makeFrostedToolbar();
    const actions: Array<{ destroy?: () => void } | void> = [];

    for (const cls of ['project-dropdown', 'split-menu', 'tab-add-menu', 'ctx-menu', 'ctx-backdrop']) {
      const popup = document.createElement('div');
      popup.className = cls;
      popup.style.position = 'fixed';
      toolbar.appendChild(popup);
      actions.push(portal(popup));
      expect(popup.parentElement).toBe(document.body);
    }

    expect(toolbar.children.length).toBe(0);
    actions.forEach(a => a?.destroy?.());
  });

  it('frees the file-tree context menu from the backdrop-filtered sidebar', () => {
    // The sidebar has the same trap as the toolbar: backdrop-filter (plum
    // theme) + overflow:hidden. FileTree's right-click menu is a fixed-position
    // descendant, so it was clipped/invisible until portaled out.
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.style.cssText = 'backdrop-filter: blur(14px); overflow: hidden;';
    document.body.appendChild(sidebar);

    const overlay = document.createElement('div');
    overlay.className = 'context-overlay';
    overlay.style.position = 'fixed';
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    sidebar.append(overlay, menu);

    const a1 = portal(overlay);
    const a2 = portal(menu);

    expect(sidebar.contains(overlay)).toBe(false);
    expect(sidebar.contains(menu)).toBe(false);
    expect(overlay.parentElement).toBe(document.body);
    expect(menu.parentElement).toBe(document.body);

    a1?.destroy?.();
    a2?.destroy?.();
  });

  it('removes the node on destroy so nothing leaks into <body>', () => {
    const popup = document.createElement('div');
    document.body.appendChild(popup);

    const action = portal(popup);
    expect(document.body.contains(popup)).toBe(true);

    action?.destroy?.();
    expect(document.body.contains(popup)).toBe(false);
  });

  it('supports an explicit target element', () => {
    const target = document.createElement('div');
    target.id = 'target';
    document.body.appendChild(target);

    const popup = document.createElement('div');
    const action = portal(popup, target);

    expect(popup.parentElement).toBe(target);
    action?.destroy?.();
  });

  it('does not throw when destroyed after the node was already detached', () => {
    const popup = document.createElement('div');
    const action = portal(popup);
    popup.remove();
    expect(() => action?.destroy?.()).not.toThrow();
  });
});
