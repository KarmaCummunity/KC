// useFirstPostNudge — eligibility + dismiss handlers for the first-post nudge.
// Mapped to FR-FEED-015 (three-tier dismiss: primary CTA, session, permanent).

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getDismissFirstPostNudgeUseCase,
  getPostRepo,
} from '../services/postsComposition';
import { getUserRepo } from '../services/userComposition';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { userProfileKeys } from '../lib/queryKeys';

interface UseFirstPostNudgeResult {
  show: boolean;
  dismissForSession: () => void;
  dismissForever: () => Promise<void>;
}

export function useFirstPostNudge(viewerId: string | null): UseFirstPostNudgeResult {
  const sessionDismissed = useFeedSessionStore((s) => s.firstPostNudgeDismissedThisSession);
  const dismissForSession = useFeedSessionStore((s) => s.dismissNudgeForSession);

  // The member's own profile under the key every other own-profile reader uses (profile chrome,
  // privacy toggle, completion nudge), so the feed shares their read instead of repeating it: one
  // own-profile read is five requests (users, cities, user_stats, bootstrap_session, karma).
  const userQuery = useQuery({
    queryKey: userProfileKeys.byId(viewerId ?? ''),
    queryFn: () => (viewerId ? getUserRepo().findById(viewerId) : null),
    enabled: viewerId !== null,
    staleTime: 5 * 60_000, // PERF-3: profile (self) — dismissForever refetches explicitly
  });

  const openPostsCountQuery = useQuery({
    queryKey: ['openPostsCount', viewerId, 'nudge'],
    queryFn: () => (viewerId ? getPostRepo().countOpenByUser(viewerId) : 0),
    enabled: viewerId !== null,
    staleTime: 5 * 60_000, // PERF-3: nudge counter — publish actions invalidate the feed; tolerable lag
  });

  const show = Boolean(
    viewerId &&
      userQuery.data &&
      !userQuery.data.firstPostNudgeDismissed &&
      !sessionDismissed &&
      openPostsCountQuery.data === 0,
  );

  const dismissForever = useCallback(async () => {
    if (!viewerId) return;
    try {
      await getDismissFirstPostNudgeUseCase().execute(viewerId);
      await userQuery.refetch();
    } catch {
      // Fall back to session dismissal so the nudge at least disappears now.
      dismissForSession();
    }
  }, [viewerId, userQuery, dismissForSession]);

  return { show, dismissForSession, dismissForever };
}
