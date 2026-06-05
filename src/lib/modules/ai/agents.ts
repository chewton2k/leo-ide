import { writable, get } from 'svelte/store';
import { persistedString } from '../session/persisted';
import { ALL_TOOL_NAMES, TOOL_SCHEMAS, type ToolName, type ToolSchema } from './tools';

export interface CustomAgent {
  id: string;
  name: string;
  systemPrompt: string;
  /** Tool names this agent may use. Empty = all tools. */
  tools: ToolName[];
}

const KEY = 'leo-custom-agents';

function load(): CustomAgent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(list: CustomAgent[]): void {
  if (list.length === 0) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(list));
}

export const customAgents = writable<CustomAgent[]>(load());
/** id of the active agent; '' = the default built-in agent. */
export const activeAgentId = persistedString('leo-active-agent', '');

export function listCustomAgents(): CustomAgent[] {
  return get(customAgents);
}
export function getCustomAgent(id: string): CustomAgent | undefined {
  return get(customAgents).find(a => a.id === id);
}
export function saveCustomAgent(agent: CustomAgent): void {
  // Drop any tool names that aren't real tools.
  const tools = agent.tools.filter(t => (ALL_TOOL_NAMES as string[]).includes(t));
  customAgents.update(list => {
    const next = list.filter(a => a.id !== agent.id).concat({ ...agent, tools });
    persist(next);
    return next;
  });
}
export function deleteCustomAgent(id: string): void {
  customAgents.update(list => {
    const next = list.filter(a => a.id !== id);
    persist(next);
    return next;
  });
  if (get(activeAgentId) === id) activeAgentId.set('');
}
export function reloadCustomAgents(): void {
  customAgents.set(load());
}

/** The currently-selected custom agent, or null for the default agent. */
export function activeAgent(): CustomAgent | null {
  const id = get(activeAgentId);
  if (!id) return null;
  return get(customAgents).find(a => a.id === id) ?? null;
}

/**
 * Tool schemas the active agent is allowed to use. Falls back to the full set
 * for the default agent or an agent with no tool restrictions.
 */
export function agentToolSchemas(agent: CustomAgent | null = activeAgent()): ToolSchema[] {
  if (!agent || agent.tools.length === 0) return TOOL_SCHEMAS;
  const allowed = new Set(agent.tools);
  return TOOL_SCHEMAS.filter(s => allowed.has(s.function.name as ToolName));
}

/** System-prompt appendix contributed by the active agent (or ''). */
export function agentSystemAppendix(agent: CustomAgent | null = activeAgent()): string {
  return agent ? `\n\nYou are acting as the "${agent.name}" agent.\n${agent.systemPrompt}` : '';
}

// ── Agent todo list (the `todo` tool) ──

export interface TodoItem { text: string; done: boolean; }

export const agentTodos = writable<TodoItem[]>([]);

/** Parse a newline-separated todo list; lines starting with [x] are done. */
export function parseTodoItems(raw: string): TodoItem[] {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => {
      const m = l.match(/^\[([ xX])\]\s*(.*)$/);
      if (m) return { text: m[2], done: m[1].toLowerCase() === 'x' };
      return { text: l.replace(/^[-*]\s*/, ''), done: false };
    });
}

export function formatTodos(items: TodoItem[]): string {
  if (items.length === 0) return 'Todo list is empty.';
  return items.map(i => `[${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
}

export function setAgentTodos(items: TodoItem[]): void {
  agentTodos.set(items);
}
