import { get } from 'svelte/store';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { persistedBoolDefaultTrue } from '../session/persisted';
import { showToast } from '../ui/toast';

/** When enabled, agent/system events surface as OS notifications (unfocused) or toasts (focused). */
export const agentNotifications = persistedBoolDefaultTrue('leo-agent-notifications');

export type NotifyChannel = 'os' | 'toast' | 'none';

/** Pure decision: where should a notification go given the setting + focus state. */
export function chooseChannel(enabled: boolean, focused: boolean): NotifyChannel {
  if (!enabled) return 'none';
  return focused ? 'toast' : 'os';
}

function toast(title: string, body: string): void {
  showToast({ level: 'info', message: body ? `${title}: ${body}` : title });
}

/** Surface a notification, guarded by the setting, focus state, and OS permission. */
export async function notify(title: string, body = ''): Promise<void> {
  const focused = typeof document !== 'undefined' ? document.hasFocus() : true;
  const channel = chooseChannel(get(agentNotifications), focused);
  if (channel === 'none') return;
  if (channel === 'toast') { toast(title, body); return; }
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (granted) sendNotification({ title, body });
    else toast(title, body);
  } catch {
    toast(title, body);
  }
}
