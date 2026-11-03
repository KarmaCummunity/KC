// FR-KARMA-009 — push karma_points + all per-user counters live by patching the
// shared ['user-profile', userId] query cache from the self-row subscription.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getUserRealtime } from '../services/userRealtimeComposition';
import { mergeSelfRealtimeUser } from '../lib/mergeSelfRealtimeUser';
import type { User } from '@kc/domain';

export function useMeRealtime(): void {
  const userId = useAuthStore((s) => s.session?.userId);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const unsub = getUserRealtime().subscribeToSelf(
      userId,
      (user) => {
        // Payload lacks owner-private columns (karma_points) — merge, then refetch via RPC.
        queryClient.setQueryData<User | null>(['user-profile', userId], (prev) => mergeSelfRealtimeUser(prev, user));
        void queryClient.invalidateQueries({ queryKey: ['user-profile', userId] });
      },
      (err) => { if (__DEV__) console.warn('[karma] self-realtime channel error:', err.message); },
    );
    return unsub;
  }, [userId, queryClient]);
}
