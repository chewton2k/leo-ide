import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { agentToolSchemas, agentSystemAppendix, parseTodoItems, formatTodos, type CustomAgent } from '../../../src/lib/modules/ai/agents';

const reviewer: CustomAgent = { id: 'rev', name: 'Reviewer', systemPrompt: 'Review only.', tools: ['read_file', 'grep'] };

describe('agentToolSchemas', () => {
  it('returns the full set for the default agent (null)', async () => {
    const { TOOL_SCHEMAS } = await import('../../../src/lib/modules/ai/tools');
    expect(agentToolSchemas(null)).toHaveLength(TOOL_SCHEMAS.length);
  });
  it('filters to the agent tool subset', () => {
    const names = agentToolSchemas(reviewer).map(s => s.function.name).sort();
    expect(names).toEqual(['grep', 'read_file']);
  });
  it('treats an empty tool list as "all tools"', async () => {
    const { TOOL_SCHEMAS } = await import('../../../src/lib/modules/ai/tools');
    expect(agentToolSchemas({ ...reviewer, tools: [] })).toHaveLength(TOOL_SCHEMAS.length);
  });
});

describe('agentSystemAppendix', () => {
  it('includes the agent name + prompt', () => {
    expect(agentSystemAppendix(reviewer)).toContain('Reviewer');
    expect(agentSystemAppendix(reviewer)).toContain('Review only.');
  });
  it('is empty for the default agent', () => {
    expect(agentSystemAppendix(null)).toBe('');
  });
});

describe('todo parsing', () => {
  it('parses [x]/[ ]/bullet lines', () => {
    const items = parseTodoItems('[x] done thing\n[ ] pending thing\n- bullet thing\n');
    expect(items).toEqual([
      { text: 'done thing', done: true },
      { text: 'pending thing', done: false },
      { text: 'bullet thing', done: false },
    ]);
  });
  it('formats back to a checkbox list', () => {
    expect(formatTodos([{ text: 'a', done: true }, { text: 'b', done: false }])).toBe('[x] a\n[ ] b');
    expect(formatTodos([])).toMatch(/empty/);
  });
});

describe('custom agents CRUD', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('saves, replaces, gets, deletes, and validates tools', async () => {
    const m = await import('../../../src/lib/modules/ai/agents');
    m.saveCustomAgent({ id: 'a', name: 'A', systemPrompt: 'p', tools: ['read_file', 'not_a_tool' as never] });
    // Invalid tool name dropped.
    expect(m.getCustomAgent('a')?.tools).toEqual(['read_file']);

    m.saveCustomAgent({ id: 'a', name: 'A2', systemPrompt: 'p2', tools: [] });
    expect(m.listCustomAgents()).toHaveLength(1);
    expect(m.getCustomAgent('a')?.name).toBe('A2');

    m.activeAgentId.set('a');
    m.deleteCustomAgent('a');
    expect(m.getCustomAgent('a')).toBeUndefined();
    expect(get(m.activeAgentId)).toBe('');
  });
});
