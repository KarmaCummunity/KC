// Hook for fetching community stats on the About screen.
// Fetches on mount, then refreshes on a timer (FR-STATS-004 AC2: about every 60 seconds): the
// baseline serves the counters from `community_stats()` and has no change feed for them.
// Mapped to FR-STATS-004.

import { useState, useEffect, useCallback } from 'react';
import { getCommunityStatsSnapshotUseCase } from '../services/postsComposition';

/** How often the counters are read again while the screen is open. */
export const COMMUNITY_STATS_REFRESH_MS = 60_000;

interface StatsState {
  readonly users: number;
  readonly posts: number;
  readonly delivered: number;
  readonly loading: boolean;
  readonly error: boolean;
}

export function useCommunityStatsAbout(): StatsState & { refetch: () => void } {
  const [state, setState] = useState<StatsState>({
    users: 0,
    posts: 0,
    delivered: 0,
    loading: true,
    error: false,
  });

  const fetchOnce = useCallback(async (guard: { cancelled: boolean }) => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const snap = await getCommunityStatsSnapshotUseCase().execute();
      if (guard.cancelled) return;
      setState({
        users: snap.registeredUsers,
        posts: snap.activePublicPosts,
        delivered: snap.itemsDeliveredTotal,
        loading: false,
        error: false,
      });
    } catch {
      if (guard.cancelled) return;
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    const guard = { cancelled: false };
    void fetchOnce(guard);
    const timer = setInterval(() => void fetchOnce(guard), COMMUNITY_STATS_REFRESH_MS);
    return () => {
      guard.cancelled = true;
      clearInterval(timer);
    };
  }, [fetchOnce]);

  const refetch = useCallback(() => {
    const guard = { cancelled: false };
    void fetchOnce(guard);
  }, [fetchOnce]);

  return { ...state, refetch };
}
