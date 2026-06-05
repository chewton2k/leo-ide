import { describe, expect, it } from 'vitest';
import { planPaneFocus } from '../../../src/lib/modules/terminal/focusManager';

describe('planPaneFocus', () => {
  it('focuses a clicked pane immediately when switching panes in the same tab', () => {
    expect(planPaneFocus({
      activeTabId: 1,
      activePaneIdForTab: 20,
      targetTabId: 1,
      targetPaneId: 10,
      reason: 'user',
    })).toEqual({
      activeChanged: true,
      focus: 'immediate',
    });
  });

  it('focuses an already-active pane immediately on user click because DOM focus may have drifted', () => {
    expect(planPaneFocus({
      activeTabId: 1,
      activePaneIdForTab: 10,
      targetTabId: 1,
      targetPaneId: 10,
      reason: 'user',
    })).toEqual({
      activeChanged: false,
      focus: 'immediate',
    });
  });

  it('keeps already-active programmatic focus as a no-op', () => {
    expect(planPaneFocus({
      activeTabId: 1,
      activePaneIdForTab: 10,
      targetTabId: 1,
      targetPaneId: 10,
      reason: 'programmatic',
    })).toEqual({
      activeChanged: false,
      focus: 'none',
    });
  });

  it('uses deferred focus for programmatic tab visibility transitions', () => {
    expect(planPaneFocus({
      activeTabId: 2,
      activePaneIdForTab: 10,
      targetTabId: 1,
      targetPaneId: 10,
      reason: 'programmatic',
    })).toEqual({
      activeChanged: true,
      focus: 'deferred',
    });
  });
});
