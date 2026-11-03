// D-206 — a feed mirror of a native listing opens the listing, not the post detail.
// The post detail is the feed's only entry point, so the redirect lives here rather
// than in every card: the mirror's own detail would show the post closure flow instead
// of the listing handoff flow.
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import type { Post } from '@kc/domain';

type MirrorSource = Pick<Post, 'listingId'> | null | undefined;

/** Replaces the current post detail with its listing's detail when the post is a mirror. */
export function useListingMirrorRedirect(post: MirrorSource): boolean {
  const router = useRouter();
  const listingId = post?.listingId ?? null;
  // One navigation per listing, however often the screen re-renders meanwhile.
  const redirectedTo = useRef<string | null>(null);

  useEffect(() => {
    if (!listingId || redirectedTo.current === listingId) return;
    redirectedTo.current = listingId;
    router.replace({
      pathname: '/listing/[listingId]',
      params: { listingId },
    });
  }, [listingId, router]);

  return listingId !== null;
}
