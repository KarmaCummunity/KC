// FR-POST-001 AC3 / FR-POST-008 — listing-world posts edit through the unified category form;
// items posts keep the dedicated item edit screen.
import type { Post } from '@kc/domain';
import { isFeedWorldSlug } from '@kc/domain';

type PostEditTarget = Pick<Post, 'postId' | 'listingId' | 'listingWorldSlug'>;

/** Route for the owner (or admin) post edit overflow action. */
export function hrefForPostEdit(post: PostEditTarget): `/edit-post/${string}` | `/edit-listing/${string}` {
  const world = post.listingWorldSlug;
  if (post.listingId && world && world !== 'items' && isFeedWorldSlug(world)) {
    return `/edit-listing/${post.postId}`;
  }
  return `/edit-post/${post.postId}`;
}
