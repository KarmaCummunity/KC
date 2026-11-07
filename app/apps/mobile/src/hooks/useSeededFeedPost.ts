import { useMemo } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { FeedPage, PostWithOwner } from '@kc/application';
import { findNewestCachedPost, type CachedPostPage } from '../lib/findNewestCachedPost';

type ClosedPage = { items: PostWithOwner[] };

// Reuse the list that matches how this screen was opened. A from-profile open
// reads the closed-posts cache, whose identity projection differs from the feed.
export function useSeededFeedPost(
  postId: string | undefined,
  viewerId: string | null,
  profileHostId: string | null,
) {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const queries = profileHostId
      ? queryClient.getQueriesData<InfiniteData<ClosedPage>>({
          queryKey: ['profile-closed-posts', profileHostId],
        })
      : queryClient.getQueriesData<InfiniteData<FeedPage>>({
          queryKey: ['feed', viewerId],
        });
    const seed = findNewestCachedPost(
      queries.map(([key, data]) => ({
        pages: data?.pages as readonly CachedPostPage<PostWithOwner>[] | undefined,
        updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0,
      })),
      postId,
    );
    // A feed card carries one photo. Paint it now, but do not treat it as a
    // fresh full post — the detail read still fills the rest, and a dropped
    // connection keeps this card on screen.
    if (!seed || profileHostId) return seed;
    return { post: seed.post, updatedAt: 1 };
  }, [queryClient, postId, viewerId, profileHostId]);
}
