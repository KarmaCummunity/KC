import { AppState } from 'react-native';
import type { IDeviceRepository } from '@kc/application';
import { registerCurrentDeviceIfPermitted } from './register';

/**
 * How long a running app goes between re-registrations of its device. A registration stamps
 * `user_devices.last_seen_at`, which drives the 90-day token prune (FR-NOTIF-015 AC4), so an
 * app kept open for months must refresh it while it runs, not only at start (KC#1723).
 */
export const DEVICE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** True when a full refresh interval passed since the last registration. */
export function isDeviceRefreshDue(lastRefreshAt: number, now: number): boolean {
  return now - lastRefreshAt >= DEVICE_REFRESH_INTERVAL_MS;
}

/**
 * Re-registers the device when the app returns to the foreground and the last registration is
 * at least a day old. The registration made when the session started counts as the first one,
 * so the clock starts at subscription time. A failed attempt is not retried until the next
 * interval: the next app start registers again anyway. Returns the unsubscribe function.
 */
export function watchDailyDeviceRefresh(
  userId: string,
  deps: { deviceRepo: IDeviceRepository },
  now: () => number = Date.now,
): () => void {
  let lastRefreshAt = now();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active' || !isDeviceRefreshDue(lastRefreshAt, now())) return;
    lastRefreshAt = now();
    registerCurrentDeviceIfPermitted(userId, deps).catch(() => undefined);
  });
  return () => subscription.remove();
}
