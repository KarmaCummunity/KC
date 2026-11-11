// Mapped to spec: FR-FEED-021 — the map runs the feed's own query (same filter, same order).
import { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PostFeedFilter } from '@kc/application';
import { getFeedUseCase } from '../services/postsComposition';
import { useAuthStore } from '../store/authStore';
import { postsToMapPins } from '../lib/postMap';

const PAGE_SIZE = 100;
const MAX_POSTS = 300;

export function usePostMapFeed(filter: PostFeedFilter) {
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const query = useInfiniteQuery({
    queryKey: ['feed-map', viewerId, filter],
    queryFn: ({ pageParam }) =>
      getFeedUseCase().execute({ viewerId, filter, limit: PAGE_SIZE, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.posts) ?? [], [query.data?.pages]);
  const pins = useMemo(() => postsToMapPins(posts), [posts]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && posts.length < MAX_POSTS) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length]);

  return { posts, pins, isLoading: query.isLoading || isFetchingNextPage, refresh: () => void query.refetch() };
}
