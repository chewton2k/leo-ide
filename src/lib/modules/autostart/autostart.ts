import { writable } from 'svelte/store';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

/** Reflects the OS launch-on-login state. Source of truth is the OS, not localStorage. */
export const autostartEnabled = writable(false);

/** Read the real OS autostart state into the store (call on mount). */
export async function syncAutostart(): Promise<void> {
  try {
    autostartEnabled.set(await isEnabled());
  } catch { /* platform/unsupported — leave default */ }
}

/** Enable or disable launch-on-login and reflect the result in the store. */
export async function setAutostart(on: boolean): Promise<void> {
  try {
    if (on) await enable(); else await disable();
    autostartEnabled.set(on);
  } catch { /* unsupported — keep current store value */ }
}
