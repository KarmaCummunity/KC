// Active-day recording — KC#1058.
// The server keeps one row per user per Israel day (`rpc_record_active_day`); the client
// calls it at most once per user per local day and shares one in-flight call, so the survey
// banner can await the same record before it asks for eligibility.
import AsyncStorage from '@react-native-async-storage/async-storage';

const RECORDED_KEY_PREFIX = 'kc-active-day-recorded-';

const inFlightByUser = new Map<string, Promise<void>>();

/** Local calendar day as YYYY-MM-DD (the dedupe key; the server derives its own day). */
export function localDayKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Calls `record` unless this user was already recorded today on this device.
 * Never throws: activity is best-effort and must not break app start.
 */
export function recordActiveDayOncePerDay(
  userId: string,
  record: () => Promise<void>,
  now: Date = new Date(),
): Promise<void> {
  const pending = inFlightByUser.get(userId);
  if (pending) return pending;

  const storageKey = RECORDED_KEY_PREFIX + userId;
  const today = localDayKey(now);
  const run = (async () => {
    try {
      if ((await AsyncStorage.getItem(storageKey)) === today) return;
      await record();
      await AsyncStorage.setItem(storageKey, today);
    } catch {
      // Best-effort: the next app open or foreground retries.
    }
  })().finally(() => inFlightByUser.delete(userId));

  inFlightByUser.set(userId, run);
  return run;
}
