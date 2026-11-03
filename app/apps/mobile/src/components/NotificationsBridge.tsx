import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';
import { useActiveScreenStore } from '../lib/notifications/useActiveScreenStore';
import { installForegroundHandler } from '../lib/notifications/foregroundHandler';
import { installBadgeAutoClear } from '../lib/notifications/badge';
import { useNotificationTapRouting } from '../lib/notifications/tapHandler';
import { registerCurrentDeviceIfPermitted } from '../lib/notifications/register';
import { ensureAndroidNotificationChannel } from '../lib/pushSetup';

export function NotificationsBridge(): null {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const setRoute = useActiveScreenStore((s) => s.setRoute);

  useNotificationTapRouting();

  useEffect(() => {
    installForegroundHandler();
    installBadgeAutoClear();
    void ensureAndroidNotificationChannel();
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    setRoute(pathname ?? null);
  }, [pathname, setRoute]);

  useEffect(() => {
    if (!userId) return;
    registerCurrentDeviceIfPermitted(userId, { deviceRepo: container.deviceRepo }).catch(
      console.error,
    );
  }, [userId]);

  return null;
}
