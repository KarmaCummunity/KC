import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';
import { useActiveScreenStore } from '../lib/notifications/useActiveScreenStore';
import { installForegroundHandler } from '../lib/notifications/foregroundHandler';
import { useNotificationTapRouting } from '../lib/notifications/tapHandler';
import { registerCurrentDeviceIfPermitted, watchPushTokenRefresh } from '../lib/notifications/register';
import { ensureNotificationChannels } from '../lib/notifications/channels';
import { syncAppBadge } from '../lib/notifications/badge';
import { useUnreadNotificationCount } from '../hooks/useNotificationInboxBadge';

export function NotificationsBridge(): null {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const setRoute = useActiveScreenStore((s) => s.setRoute);

  useNotificationTapRouting();

  useEffect(() => {
    installForegroundHandler();
    ensureNotificationChannels().catch(console.error);
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    setRoute(pathname ?? null);
  }, [pathname, setRoute]);

  useEffect(() => {
    if (!userId) return undefined;
    const deps = { deviceRepo: container.deviceRepo };
    registerCurrentDeviceIfPermitted(userId, deps).catch(console.error);
    return watchPushTokenRefresh(userId, deps);
  }, [userId]);

  // The app icon shows the same unread count as the bell; signed out it is cleared.
  const unread = useUnreadNotificationCount(userId);
  useEffect(() => {
    syncAppBadge(unread);
  }, [unread]);

  return null;
}
