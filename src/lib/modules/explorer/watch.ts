import { invoke } from '@tauri-apps/api/core';

export function watchAdd(paths: string[]): void {
  if (paths.length === 0) return;
  void invoke('fs_watch_add', { paths }).catch(() => {});
}

export function watchRemove(paths: string[]): void {
  if (paths.length === 0) return;
  void invoke('fs_watch_remove', { paths }).catch(() => {});
}
