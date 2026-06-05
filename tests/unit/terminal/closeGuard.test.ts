import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ask } from '@tauri-apps/plugin-dialog';
import { mockInvoke } from '../../mocks/tauri';
import { confirmTerminalClose } from '../../../src/lib/modules/terminal/terminalActions';

beforeEach(() => { vi.clearAllMocks(); });

describe('confirmTerminalClose', () => {
  it('allows closing without prompting when no foreground process', async () => {
    mockInvoke('pty_has_foreground_process', () => false);
    expect(await confirmTerminalClose(1)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it('prompts when a foreground process runs and returns the user choice', async () => {
    mockInvoke('pty_has_foreground_process', () => true);
    (ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    expect(await confirmTerminalClose(1)).toBe(true);
    (ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    expect(await confirmTerminalClose(1)).toBe(false);
  });
  it('fails open (allows close) if the backend check throws', async () => {
    mockInvoke('pty_has_foreground_process', () => { throw new Error('no session'); });
    expect(await confirmTerminalClose(1)).toBe(true);
  });
});
