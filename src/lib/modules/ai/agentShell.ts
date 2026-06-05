import { invoke } from '@tauri-apps/api/core';

export interface SessionRun {
  stdout: string;
  stderr: string;
  exit_code: number;
  cwd: string;
}

let session: { id: number; root: string } | null = null;

/** Forget the cached agent session (e.g. on project switch or chat clear). */
export function resetAgentSession(): void {
  session = null;
}

async function ensureSession(root: string): Promise<number> {
  if (session?.root === root) return session.id;
  const id = await invoke<number>('shell_session_open', { cwd: root });
  session = { id, root };
  return id;
}

/**
 * Run a command in the agent's persistent shell session so `cd` and env
 * persist across tool calls. Reopens once if the session went stale.
 */
export async function runInAgentSession(command: string, root: string, timeoutMs = 30000): Promise<SessionRun> {
  const id = await ensureSession(root);
  try {
    return await invoke<SessionRun>('shell_session_run', { id, command, timeoutMs });
  } catch (e) {
    if (!/no such shell session/i.test(String(e))) throw e;
    session = null;
    const retryId = await ensureSession(root);
    return await invoke<SessionRun>('shell_session_run', { id: retryId, command, timeoutMs });
  }
}

export function formatCommandResult(r: { stdout: string; stderr: string; exit_code: number }, max = 4000): string {
  let output = '';
  if (r.stdout) output += r.stdout;
  if (r.stderr) output += (output ? '\n' : '') + r.stderr;
  if (!output) output = `(no output, exit code: ${r.exit_code})`;
  if (output.length > max) output = output.slice(0, max) + '\n... (truncated)';
  return output;
}
