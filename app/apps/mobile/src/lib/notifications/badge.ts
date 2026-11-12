import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Shows the member's unread notifications on the app icon. The number comes from the
 * database (`notifications_unread_count`, the realtime `badge` event and the `badge` of
 * every push), so the icon, the bell and the centre always agree. Signed out = 0.
 */
export function syncAppBadge(unreadCount: number): void {
  if (Platform.OS === 'web') return;
  const count = Number.isFinite(unreadCount) ? Math.max(0, Math.trunc(unreadCount)) : 0;
  Notifications.setBadgeCountAsync(count).catch(() => undefined);
}
