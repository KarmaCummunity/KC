import type { QueryClient } from '@tanstack/react-query';

/** Reconcile this client's cached views of the removed follower -> owner edge (#1780). */
export function invalidateRemovedFollower(
  client: QueryClient,
  owner: { userId: string; shareHandle: string },
  follower: { userId: string; shareHandle: string },
): void {
  const queryKeys = [
    ['followers', owner.userId],
    ['following', follower.userId],
    ['user-profile', owner.userId],
    ['user-profile', follower.userId],
    ['profile-other', owner.shareHandle],
    ['profile-other', follower.shareHandle],
    ['follow-state', follower.userId, owner.userId],
  ] as const;
  for (const queryKey of queryKeys) void client.invalidateQueries({ queryKey });
}
