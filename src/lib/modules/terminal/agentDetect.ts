import { writable } from 'svelte/store';
import type { Terminal } from '@xterm/xterm';

export type AgentSignal = 'started' | 'working' | 'attention' | 'finished';

/** The current agent status shown in the statusbar (null = no agent active). */
export const agentTerminalStatus = writable<'working' | 'attention' | 'finished' | null>(null);

export interface AgentState { armed: boolean; status: 'working' | 'waiting'; }
export function createAgentState(): AgentState { return { armed: false, status: 'working' }; }

const EVENTS = new Set(['working', 'attention', 'finished']);

/**
 * Advance the agent state from an OSC 777 payload of the form
 * `notify;<source>;<event>` (event in working|attention|finished), mirroring
 * 'started'). Pure: mutates the passed-in state and returns signals to emit.
 */
export function applyOsc777(state: AgentState, payload: string): AgentSignal[] {
  const parts = payload.split(';');
  if (parts[0] !== 'notify') return [];
  const event = parts[2];
  if (!event || !EVENTS.has(event)) return [];
  const out: AgentSignal[] = [];
  if (!state.armed) { state.armed = true; state.status = 'working'; out.push('started'); }
  if (event === 'working') {
    if (state.status !== 'working') { state.status = 'working'; out.push('working'); }
  } else {
    state.status = 'waiting';
    out.push(event as AgentSignal);
  }
  return out;
}

/** Register an OSC 777 handler that emits agent signals. Returns a disposer. */
export function registerAgentDetect(term: Terminal, onSignal: (s: AgentSignal) => void): () => void {
  const state = createAgentState();
  const d = term.parser.registerOscHandler(777, (data) => {
    for (const sig of applyOsc777(state, data)) onSignal(sig);
    return true;
  });
  return () => d.dispose();
}
