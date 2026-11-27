import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { currentNotificationPresentation } from './currentNotificationPresentation';

/**
 * Shows the member's unread notifications on the app icon. The number comes from the
 * database (`notifications_unread_count`, the realtime `badge` event and the `badge` of
 * every push), so the icon, the bell and the centre always agree. Signed out = 0.
 */
export async function syncAppBadge(unreadCount: number): Promise<void> {
  if (Platform.OS === 'web') return;
  const count = Number.isFinite(unreadCount) ? Math.max(0, Math.trunc(unreadCount)) : 0;
  // Clearing removes a stale badge even after revocation; positive counts need current consent.
  if (count > 0 && !(await currentNotificationPresentation()).shouldSetBadge) return;
  await Notifications.setBadgeCountAsync(count).catch(() => undefined);
}
