import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { autostartEnabled, syncAutostart, setAutostart } from '../../../src/lib/modules/autostart/autostart';

beforeEach(() => { autostartEnabled.set(false); vi.clearAllMocks(); });

describe('setAutostart', () => {
  it('enables and reflects in the store', async () => {
    await setAutostart(true);
    expect(enable).toHaveBeenCalledOnce();
    expect(get(autostartEnabled)).toBe(true);
  });
  it('disables and reflects in the store', async () => {
    autostartEnabled.set(true);
    await setAutostart(false);
    expect(disable).toHaveBeenCalledOnce();
    expect(get(autostartEnabled)).toBe(false);
  });
});

describe('syncAutostart', () => {
  it('reads the OS state into the store', async () => {
    (isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    await syncAutostart();
    expect(get(autostartEnabled)).toBe(true);
  });
});
