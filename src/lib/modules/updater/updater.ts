import { writable } from 'svelte/store';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { log } from '../logging';

export type UpdaterStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; downloaded: number; total: number | null }
  | { kind: 'ready' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string };

export const updaterStatus = writable<UpdaterStatus>({ kind: 'idle' });

export function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('-')[0].split('.').map(p => Number.parseInt(p, 10) || 0);
}

/** True when `remote` is a strictly newer semver than `current`. */
export function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Heuristic: an unconfigured build (no `plugins.updater`) vs a real failure. */
function isUnconfigured(message: string): boolean {
  return /endpoint|not configured|missing.*config|plugins?\W+updater|no.*updater/i.test(message);
}

let pending: Update | null = null;

export async function checkForUpdates(): Promise<void> {
  updaterStatus.set({ kind: 'checking' });
  try {
    const update = await check();
    if (update) {
      pending = update;
      updaterStatus.set({ kind: 'available', version: update.version });
    } else {
      updaterStatus.set({ kind: 'uptodate' });
    }
  } catch (err) {
    const message = String(err);
    if (isUnconfigured(message)) {
      updaterStatus.set({ kind: 'disabled' });
    } else {
      log.warn('Update check failed', err);
      updaterStatus.set({ kind: 'error', message });
    }
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) return;
  let downloaded = 0;
  let total: number | null = null;
  updaterStatus.set({ kind: 'downloading', downloaded: 0, total: null });
  try {
    await pending.downloadAndInstall(event => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? null;
        updaterStatus.set({ kind: 'downloading', downloaded: 0, total });
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        updaterStatus.set({ kind: 'downloading', downloaded, total });
      } else if (event.event === 'Finished') {
        updaterStatus.set({ kind: 'ready' });
      }
    });
    await relaunch();
  } catch (err) {
    log.warn('Update install failed', err);
    updaterStatus.set({ kind: 'error', message: String(err) });
  }
}
