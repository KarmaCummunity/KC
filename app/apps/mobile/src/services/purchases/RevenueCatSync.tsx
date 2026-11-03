import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { syncRevenueCatUser } from './revenuecat';

/** Keeps the RevenueCat identity in step with the KC session (logIn on sign-in, logOut on sign-out). */
export function RevenueCatSync(): null {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  useEffect(() => {
    void syncRevenueCatUser(userId);
  }, [userId]);
  return null;
}
