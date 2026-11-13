import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useLaunchSurface } from '../../hooks/useLaunchSurface';
import { syncRevenueCatUser } from './revenuecat';

/**
 * Keeps the RevenueCat identity in step with the KC session (logIn on sign-in, logOut on sign-out).
 * While the `payments` launch surface is off (a production first launch) the SDK is never configured
 * and no purchase identity leaves the device; turning it on later configures it on the next render.
 */
export function RevenueCatSync(): null {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const paymentsOn = useLaunchSurface('payments');
  useEffect(() => {
    if (!paymentsOn) return;
    void syncRevenueCatUser(userId);
  }, [userId, paymentsOn]);
  return null;
}
