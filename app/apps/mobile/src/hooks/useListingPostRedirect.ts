// G1 step 4a (ADR-006) — one detail screen: a listing that has a post is shown at /post/[id].
// The listing routes (/listing/[listingId] and the marketplace tab route) forward there, so a
// card, a chat anchor, a match or an old notification that still holds a listing id lands on the
// same screen as the feed. A listing without a post (not yet published, or closed before it got
// one) stays on the listing detail.
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import type { MarketplaceListingDetail } from '@kc/domain';

type ListingPostSource = Pick<MarketplaceListingDetail, 'feedPostId'> | null | undefined;

/**
 * Forwards the listing route to its post's detail when the listing has a post. Back from the post
 * returns to the screen the listing was opened from.
 */
export function useListingPostRedirect(detail: ListingPostSource): boolean {
  const router = useRouter();
  const postId = detail?.feedPostId ?? null;
  // One navigation per post, however often the screen re-renders meanwhile.
  const redirectedTo = useRef<string | null>(null);

  useEffect(() => {
    if (!postId || redirectedTo.current === postId) return;
    redirectedTo.current = postId;
    const post = { pathname: '/post/[id]', params: { id: postId } } as const;
    // The listing route is only a hop. `/post/[id]` is a root-stack route, so a `replace` from the
    // tab stack's listing route replaces the root stack's current route, the whole tab host, and
    // Back from the post then left the app (Maestro flow 17). Pop the hop and push the post instead.
    // With no history (a deep link) there is nothing to pop, and a replace is right.
    if (router.canGoBack()) {
      router.back();
      router.push(post);
    } else {
      router.replace(post);
    }
  }, [postId, router]);

  return postId !== null;
}
