// FR-KARMA-009 — keeps the signed-in member's karma and profile counters live: the counters the
// server pushes on the member's own stats topic patch the shared ['user-profile', userId] cache,
// and the karma history is marked stale so it re-reads when shown. A dropped channel costs only
// freshness: every screen still reads the counters on mount.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { getUserRealtime } from '../services/userRealtimeComposition';
import { mergeStatsChange } from '../lib/mergeStatsChange';

/** Mount once near the root. */
export function useMeRealtime(): void {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    return getUserRealtime().subscribeToStats(userId, (change) => {
      queryClient.setQueryData<User | null>(['user-profile', userId], (prev) => mergeStatsChange(prev, change));
      void queryClient.invalidateQueries({ queryKey: ['karma-history', userId] });
    });
  }, [userId, queryClient]);
}
