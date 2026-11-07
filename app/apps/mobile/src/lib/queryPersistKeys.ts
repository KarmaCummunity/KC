import type { QueryKey } from '@tanstack/react-query';

/** Query roots worth persisting for instant feed / profile / inbox cold start. */
export const PERSISTABLE_ROOTS = new Set([
  'feed',
  // A post that already opened survives a dropped connection and the next launch.
  'post',
  'profile-closed-posts',
  'user-profile',
  'profile-other',
  'profile-posts',
  'posts-by-user',
  'chat-inbox',
  'saved-posts',
  'following',
  'followers',
  'notification-inbox',
  // FR-FEED-017+ — explore + last search sessions survive cold start (PERF-6).
  'universalSearch',
]);

export function isPersistableQueryKey(queryKey: QueryKey): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && PERSISTABLE_ROOTS.has(root);
}
