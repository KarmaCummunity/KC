// G1 step 4a (ADR-006) — one detail screen: a listing that has a post is shown at /post/[id].
// The listing routes (/listing/[listingId] and the marketplace tab route) forward there, so a
// card, a chat anchor, a match or an old notification that still holds a listing id lands on the
// same screen as the feed. A listing without a post (not yet published, or closed before it got
// one) stays on the listing detail.
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import type { MarketplaceListingDetail } from '@kc/domain';

type ListingPostSource = Pick<MarketplaceListingDetail, 'feedPostId'> | null | undefined;

/** Replaces the listing route with its post's detail when the listing has a post. */
export function useListingPostRedirect(detail: ListingPostSource): boolean {
  const router = useRouter();
  const postId = detail?.feedPostId ?? null;
  // One navigation per post, however often the screen re-renders meanwhile.
  const redirectedTo = useRef<string | null>(null);

  useEffect(() => {
    if (!postId || redirectedTo.current === postId) return;
    redirectedTo.current = postId;
    router.replace({ pathname: '/post/[id]', params: { id: postId } });
  }, [postId, router]);

  return postId !== null;
}
