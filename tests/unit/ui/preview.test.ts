import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PORT_PRESETS, presetUrl, IDLE_SUSPEND_MS, createIdleSuspender } from '../../../src/lib/modules/preview/preview';

describe('presetUrl', () => {
  it('builds a localhost URL for a port', () => {
    expect(presetUrl(5173)).toBe('http://localhost:5173');
  });
  it('exposes common dev ports', () => {
    expect(PORT_PRESETS).toContain(3000);
    expect(PORT_PRESETS).toContain(5173);
  });
});

describe('createIdleSuspender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('suspends after the idle delay when hidden', () => {
    const onSuspend = vi.fn();
    const s = createIdleSuspender(onSuspend);
    s.hidden();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS - 1);
    expect(onSuspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSuspend).toHaveBeenCalledOnce();
  });

  it('shown() cancels a pending suspend', () => {
    const onSuspend = vi.fn();
    const s = createIdleSuspender(onSuspend, 1000);
    s.hidden();
    vi.advanceTimersByTime(500);
    s.shown();
    vi.advanceTimersByTime(1000);
    expect(onSuspend).not.toHaveBeenCalled();
  });

  it('hidden() is idempotent (does not stack timers)', () => {
    const onSuspend = vi.fn();
    const s = createIdleSuspender(onSuspend, 1000);
    s.hidden(); s.hidden(); s.hidden();
    vi.advanceTimersByTime(1000);
    expect(onSuspend).toHaveBeenCalledOnce();
  });
});
