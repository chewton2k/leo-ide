/** Common local dev-server ports offered as quick presets in the preview bar. */
export const PORT_PRESETS = [3000, 5173, 8080, 4200, 8000, 1313];

export function presetUrl(port: number): string {
  return `http://localhost:${port}`;
}

/** How long the preview can stay hidden before its iframe is suspended. */
export const IDLE_SUSPEND_MS = 30_000;

export interface IdleSuspender {
  /** Preview became hidden — arm the suspend timer (no-op if already armed). */
  hidden(): void;
  /** Preview became visible — cancel any pending suspend. */
  shown(): void;
  dispose(): void;
}

/**
 * Suspends an idle (hidden) preview after `delayMs` to free the embedded
 * webview's resources. `onSuspend` runs once when the timer elapses; calling
 * `shown()` before then cancels it.
 */
export function createIdleSuspender(onSuspend: () => void, delayMs = IDLE_SUSPEND_MS): IdleSuspender {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return {
    hidden() {
      if (timer) return;
      timer = setTimeout(() => { timer = null; onSuspend(); }, delayMs);
    },
    shown: cancel,
    dispose: cancel,
  };
}
