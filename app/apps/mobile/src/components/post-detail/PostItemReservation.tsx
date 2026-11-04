// G1 step 4b (ADR-006) — the reservation of an item made through the post form, on its post page.
// Such an item owns a derived listing (0243) that carries the reservation: reserve for pickup or
// delivery, confirm, hand over, cancel and rate. The listing detail opens by post id (0561), so
// the post page shows the same actions the listing screen does; handing over closes the post
// through its closure (G34, 0559).
import React from 'react';
import type { PostWithOwner } from '@kc/application';
import { useMarketplaceListingDetail } from '../../hooks/useMarketplaceListingDetail';
import { GivingHandoffActions } from '../marketplace/GivingHandoffActions';

type Props = { readonly post: PostWithOwner };

/** True for a giving post that owns its listing (made through the post form), while it can still be acted on. */
export function postHasItemReservation(post: Pick<PostWithOwner, 'type' | 'listingId' | 'status'>): boolean {
  // Open: reserve / confirm / hand over. Delivered: the two sides still rate the hand-over.
  return post.type === 'Give' && post.listingId === null && (post.status === 'open' || post.status === 'closed_delivered');
}

export function PostItemReservation({ post }: Props) {
  const enabled = postHasItemReservation(post);
  const { data: detail } = useMarketplaceListingDetail(enabled ? post.postId : undefined);
  if (!enabled || !detail) return null;
  return <GivingHandoffActions detail={detail} />;
}
