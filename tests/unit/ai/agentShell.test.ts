import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke, getInvokeCalls } from '../../mocks/tauri';
import { runInAgentSession, formatCommandResult, resetAgentSession } from '../../../src/lib/modules/ai/agentShell';

beforeEach(() => { resetAgentSession(); });

describe('formatCommandResult', () => {
  it('combines stdout and stderr', () => {
    expect(formatCommandResult({ stdout: 'out', stderr: 'err', exit_code: 0 })).toBe('out\nerr');
  });
  it('reports exit code when there is no output', () => {
    expect(formatCommandResult({ stdout: '', stderr: '', exit_code: 3 })).toBe('(no output, exit code: 3)');
  });
  it('truncates output beyond max', () => {
    const r = formatCommandResult({ stdout: 'x'.repeat(5000), stderr: '', exit_code: 0 }, 4000);
    expect(r.endsWith('... (truncated)')).toBe(true);
    expect(r.length).toBeLessThan(5000);
  });
});

describe('runInAgentSession', () => {
  it('opens the session once and reuses it for the same root', async () => {
    let nextId = 1;
    mockInvoke('shell_session_open', () => nextId++);
    mockInvoke('shell_session_run', () => ({ stdout: 'ok', stderr: '', exit_code: 0, cwd: '/r' }));
    await runInAgentSession('echo a', '/r');
    await runInAgentSession('echo b', '/r');
    expect(getInvokeCalls('shell_session_open').length).toBe(1);
    expect(getInvokeCalls('shell_session_run').length).toBe(2);
  });

  it('reopens when the project root changes', async () => {
    let nextId = 1;
    mockInvoke('shell_session_open', () => nextId++);
    mockInvoke('shell_session_run', () => ({ stdout: '', stderr: '', exit_code: 0, cwd: '/r' }));
    await runInAgentSession('pwd', '/r1');
    await runInAgentSession('pwd', '/r2');
    expect(getInvokeCalls('shell_session_open').length).toBe(2);
  });

  it('reopens and retries once when the session is stale', async () => {
    let nextId = 1;
    mockInvoke('shell_session_open', () => nextId++);
    let runCalls = 0;
    mockInvoke('shell_session_run', () => {
      runCalls++;
      if (runCalls === 1) throw new Error('No such shell session');
      return { stdout: 'recovered', stderr: '', exit_code: 0, cwd: '/r' };
    });
    const r = await runInAgentSession('echo hi', '/r');
    expect(r.stdout).toBe('recovered');
    expect(getInvokeCalls('shell_session_open').length).toBe(2);
    expect(runCalls).toBe(2);
  });

  it('does not retry (no double-run) on non-session errors like timeouts', async () => {
    mockInvoke('shell_session_open', () => 1);
    let runCalls = 0;
    mockInvoke('shell_session_run', () => { runCalls++; throw new Error('command timed out'); });
    await expect(runInAgentSession('sleep 999', '/r')).rejects.toThrow('timed out');
    expect(runCalls).toBe(1);
  });
});
