// app/apps/mobile/src/hooks/useOptimisticFollowAction.ts
// FR-FOLLOW-001 AC4 / FR-FOLLOW-006 AC3 — optimistic follow-state dispatcher
// with snapshot+rollback on error. Updates four caches optimistically
// (follow-state, profile-other.followersCount, user-profile.followingCount,
// list-invalidations) so every counter the viewer can see reconciles
// without a refetch round-trip. Surface errors via onError callback (caller
// renders the cross-platform NotifyModal — Alert.alert is a no-op on
// react-native-web 0.21.2).

import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isFollowError, type FollowState, type FollowStateInfo } from '@kc/application';
import type { User } from '@kc/domain';
import {
  getFollowUserUseCase,
  getUnfollowUserUseCase,
  getSendFollowRequestUseCase,
  getCancelFollowRequestUseCase,
} from '../services/followComposition';

export type FollowAction = 'follow' | 'unfollow' | 'send' | 'cancel';

export interface FollowActionError {
  title: string;
  message: string;
}

export interface UseOptimisticFollowActionParams {
  viewerId: string | undefined;
  target: User;
  /** Route param `handle`, used as the cache key of `['profile-other', handle]`. */
  handle: string;
  /** Called when the action fails after rollback. Receives a localized title+message. */
  onError?: (err: FollowActionError) => void;
}

export function useOptimisticFollowAction({
  viewerId, target, handle, onError,
}: UseOptimisticFollowActionParams) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return async (action: FollowAction): Promise<void> => {
    if (!viewerId) return;
    const followStateKey = ['follow-state', viewerId, target.userId] as const;
    const profileOtherKey = ['profile-other', handle] as const;
    const userProfileKey = ['user-profile', viewerId] as const;

    const prevFollowState = qc.getQueryData<FollowStateInfo>(followStateKey);
    const prevTarget = qc.getQueryData<User | null>(profileOtherKey);
    const prevViewer = qc.getQueryData<User | null>(userProfileKey);

    const nextState: FollowState =
      action === 'follow' ? 'following'
      : action === 'unfollow' ? (target.privacyMode === 'Private' ? 'not_following_private_no_request' : 'not_following_public')
      : action === 'send' ? 'request_pending'
      : 'not_following_private_no_request';
    // Counter delta: only follow/unfollow change the edge graph. send/cancel
    // touch follow_requests, not follows — counters unaffected.
    const countDelta = action === 'follow' ? 1 : action === 'unfollow' ? -1 : 0;

    qc.setQueryData<FollowStateInfo>(followStateKey, { state: nextState });
    if (countDelta !== 0) {
      // Functional updaters: TanStack Query ≥5.104 Updater typing rejects object
      // literals under exactOptionalPropertyTypes / NoInfer.
      if (prevTarget) {
        qc.setQueryData<User | null>(profileOtherKey, (old) =>
          old
            ? { ...old, followersCount: Math.max(0, old.followersCount + countDelta) }
            : old,
        );
      }
      if (prevViewer) {
        qc.setQueryData<User | null>(userProfileKey, (old) =>
          old
            ? { ...old, followingCount: Math.max(0, old.followingCount + countDelta) }
            : old,
        );
      }
    }

    try {
      if (action === 'follow') await getFollowUserUseCase().execute({ viewerId, targetUserId: target.userId });
      else if (action === 'unfollow') await getUnfollowUserUseCase().execute({ viewerId, targetUserId: target.userId });
      else if (action === 'send') await getSendFollowRequestUseCase().execute({ viewerId, targetUserId: target.userId });
      else await getCancelFollowRequestUseCase().execute({ viewerId, targetUserId: target.userId });

      // Reconcile every cache that depends on this edge.
      qc.invalidateQueries({ queryKey: followStateKey });
      qc.invalidateQueries({ queryKey: profileOtherKey });
      qc.invalidateQueries({ queryKey: userProfileKey });
      qc.invalidateQueries({ queryKey: ['following', viewerId] });
      qc.invalidateQueries({ queryKey: ['followers', target.userId] });
    } catch (err) {
      qc.setQueryData(followStateKey, prevFollowState);
      qc.setQueryData(profileOtherKey, prevTarget);
      qc.setQueryData(userProfileKey, prevViewer);
      if (!onError) return;
      if (isFollowError(err) && err.code === 'cooldown_active') {
        const days = err.cooldownUntil ? Math.max(0, Math.ceil(
          (new Date(err.cooldownUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )) : 0;
        onError({ title: t('profile.followCooldownTitle'), message: t('profile.followCooldownDays', { count: days }) });
      } else if (isFollowError(err) && err.code === 'rate_limited') {
        onError({ title: t('profile.followErrorTitle'), message: t('profile.followRateLimited') });
      } else if (isFollowError(err) && err.code === 'account_not_active') {
        onError({ title: t('profile.followErrorTitle'), message: t('profile.followAccountNotActive') });
      } else {
        onError({ title: t('profile.followErrorTitle'), message: t('profile.followErrorMessage') });
      }
    }
  };
}
