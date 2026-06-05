import { describe, it, expect } from 'vitest';
import { createAgentState, applyOsc777 } from '../../../src/lib/modules/terminal/agentDetect';

describe('applyOsc777', () => {
  it('auto-arms on the first signal (emits started first)', () => {
    const s = createAgentState();
    expect(applyOsc777(s, 'notify;Leo;attention')).toEqual(['started', 'attention']);
  });
  it('emits working only when transitioning back to working', () => {
    const s = createAgentState();
    applyOsc777(s, 'notify;Leo;attention'); // armed, waiting
    expect(applyOsc777(s, 'notify;Leo;working')).toEqual(['working']);
    expect(applyOsc777(s, 'notify;Leo;working')).toEqual([]); // already working
  });
  it('emits finished', () => {
    const s = createAgentState();
    applyOsc777(s, 'notify;Leo;working');
    expect(applyOsc777(s, 'notify;Leo;finished')).toEqual(['finished']);
  });
  it('ignores non-notify payloads and unknown events', () => {
    const s = createAgentState();
    expect(applyOsc777(s, '4;1;50')).toEqual([]);
    expect(applyOsc777(s, 'notify;Leo;bogus')).toEqual([]);
    expect(applyOsc777(s, 'notify;Leo')).toEqual([]);
    expect(s.armed).toBe(false);
  });
});
