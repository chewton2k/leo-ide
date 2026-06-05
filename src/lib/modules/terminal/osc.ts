import type { Terminal } from '@xterm/xterm';

/** Parse an OSC 7 payload (`file://host/path`) into a filesystem path, or null. */
export function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try { path = decodeURIComponent(path); } catch { /* keep raw on bad escape */ }
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

export interface ShellIntegrationState { inCommand: boolean; }

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

/**
 * Pure OSC 133 transition: are we inside a running command after seeing `data`?
 * A = new prompt (between commands), B/C = command begins/pre-exec, D = command ends.
 */
export function nextInCommand(current: boolean, data: string): boolean {
  if (data.startsWith('A') || data.startsWith('D')) return false;
  if (data.startsWith('B') || data.startsWith('C')) return true;
  return current;
}

/**
 * Register OSC 7 (cwd) + OSC 133 (prompt markers) handlers on an xterm instance.
 * cwd reported while a command is running is ignored — command output is
 * untrusted (could be a remote shell or a `cat` of attacker-controlled bytes);
 * only the local shell emits OSC 7 between commands. Returns a disposer.
 */
export function registerOscHandlers(term: Terminal, onCwd: (cwd: string) => void): () => void {
  const state = createShellIntegrationState();
  const d7 = term.parser.registerOscHandler(7, (data) => {
    if (!state.inCommand) {
      const cwd = parseOsc7(data);
      if (cwd) onCwd(cwd);
    }
    return true;
  });
  const d133 = term.parser.registerOscHandler(133, (data) => {
    state.inCommand = nextInCommand(state.inCommand, data);
    return true;
  });
  return () => { d7.dispose(); d133.dispose(); };
}
