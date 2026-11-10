import type { PostWithOwner } from '@kc/application';

/**
 * Drops posts whose owner row cannot be resolved (deleted / non-active account) while the
 * card still expects a navigable author. Intentionally masked identities
 * (`ownerProfileNavigableFromPost === false`) are kept — they render as anonymous, not deleted.
 */
export function dropOrphanDeletedOwnerPosts(
  posts: readonly PostWithOwner[],
  viewerId: string | null,
): PostWithOwner[] {
  return posts.filter((p) => !isOrphanDeletedOwnerPost(p, viewerId));
}

export function isOrphanDeletedOwnerPost(post: PostWithOwner, viewerId: string | null): boolean {
  if (viewerId && post.ownerId === viewerId) return false;
  if (post.ownerProfileNavigableFromPost === false) return false;
  const handle = post.ownerHandle?.trim() ?? '';
  const name = post.ownerName?.trim() ?? '';
  return handle.length === 0 && name.length === 0;
}
