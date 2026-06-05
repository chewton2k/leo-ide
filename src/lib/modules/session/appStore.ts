import { LazyStore } from '@tauri-apps/plugin-store';

/**
 * Cross-process persistent key/value store (tauri-plugin-store). ADDITIVE:
 * existing settings stay on synchronous localStorage (see persisted.ts); this
 * is for values that must survive across separate webview processes. Async by
 * nature — do not use where a synchronous initial read is required.
 */
const store = new LazyStore('leo-settings.json');

export async function getStoreValue<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await store.get<T>(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setStoreValue<T>(key: string, value: T): Promise<void> {
  try { await store.set(key, value); await store.save(); } catch { /* store unavailable */ }
}

export async function deleteStoreValue(key: string): Promise<void> {
  try { await store.delete(key); await store.save(); } catch { /* store unavailable */ }
}
