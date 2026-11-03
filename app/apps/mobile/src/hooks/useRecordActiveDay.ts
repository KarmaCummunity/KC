// Records the signed-in user's active day on app open and on every return to the
// foreground (the app may stay open across midnight). KC#1058.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';
import { recordActiveDayOncePerDay } from '../lib/activeDay';

export function useRecordActiveDay(): void {
  const userId = useAuthStore((s) => s.session?.userId ?? null);

  useEffect(() => {
    if (!userId) return;
    const record = () => recordActiveDayOncePerDay(userId, () => container.recordActiveDay.execute());
    void record();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void record();
    });
    return () => sub.remove();
  }, [userId]);
}
