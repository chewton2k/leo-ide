export type PaneFocusReason = 'programmatic' | 'user';

/**
 * Idempotent per-tab active-pane update.
 *
 * Returns the SAME map reference when `tabId` is already set to `paneId`, so
 * reactive readers (notably Terminal.svelte's `$activeFilePath` effect, which
 * reads `activePaneByTab`) do NOT re-run on no-op focus calls. Re-allocating a
 * new object every time `focusPane` ran — even when the active pane was
 * unchanged — re-triggered that effect, which scheduled another
 * `requestAnimationFrame(focusPane)`, which called `setActivePane` again… a
 * self-sustaining rAF loop. In tab mode an in-flight loop callback held a
 * stale pane id and stole focus back to the previously-active (newest) pane,
 * so clicking the original split pane never gave it the keyboard.
 */
export function setActivePaneId(
  map: Record<number, number | null>,
  tabId: number,
  paneId: number | null,
): Record<number, number | null> {
  if (map[tabId] === paneId) return map;
  return { ...map, [tabId]: paneId };
}

export type PaneFocusPlan = {
  activeChanged: boolean;
  focus: 'none' | 'deferred' | 'immediate';
};

export function planPaneFocus(input: {
  activeTabId: number | null;
  activePaneIdForTab: number | null | undefined;
  targetTabId: number;
  targetPaneId: number;
  reason: PaneFocusReason;
}): PaneFocusPlan {
  const alreadyActive =
    input.activeTabId === input.targetTabId &&
    input.activePaneIdForTab === input.targetPaneId;

  if (alreadyActive) {
    return {
      activeChanged: false,
      focus: input.reason === 'user' ? 'immediate' : 'none',
    };
  }

  return {
    activeChanged: true,
    focus: input.reason === 'user' ? 'immediate' : 'deferred',
  };
}
