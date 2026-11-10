// G1 step 4b (ADR-006) — which posts carry the item reservation on their own page.
import type { Post } from '@kc/domain';

/** True for a giving post that owns its listing (made through the post form), while it can still be acted on. */
export function postHasItemReservation(post: Pick<Post, 'type' | 'listingId' | 'status'>): boolean {
  // Open: reserve / confirm / hand over. Delivered: the two sides still rate the hand-over.
  return post.type === 'Give' && post.listingId === null && (post.status === 'open' || post.status === 'closed_delivered');
}
