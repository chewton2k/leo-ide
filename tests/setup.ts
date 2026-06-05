import { vi, beforeEach } from 'vitest';
import { resetInvokeMocks, resetEventMocks, invoke, listen } from './mocks/tauri';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}));

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen,
}));

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async () => true),
  watch: vi.fn(async () => () => {}),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));

// Mock @tauri-apps/plugin-updater
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(async () => null),
}));

// Mock @tauri-apps/plugin-process
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(async () => {}),
}));

// Mock @tauri-apps/plugin-notification
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(() => {}),
}));

// Mock @tauri-apps/plugin-autostart
vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  isEnabled: vi.fn(async () => false),
}));

// Mock @tauri-apps/plugin-store (in-memory LazyStore)
vi.mock('@tauri-apps/plugin-store', () => {
  class LazyStore {
    private m = new Map<string, unknown>();
    async get<T>(k: string): Promise<T | undefined> { return this.m.get(k) as T | undefined; }
    async set(k: string, v: unknown): Promise<void> { this.m.set(k, v); }
    async delete(k: string): Promise<void> { this.m.delete(k); }
    async save(): Promise<void> {}
  }
  return { LazyStore };
});

// Reset all mocks between tests
beforeEach(() => {
  resetInvokeMocks();
  resetEventMocks();
  vi.clearAllMocks();
});
