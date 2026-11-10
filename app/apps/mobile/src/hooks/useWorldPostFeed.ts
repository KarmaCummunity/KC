// Mapped to spec: FR-FEED-020 AC2 — one giving world's feed: the main feed's posts query
// (FR-FEED-001, keyset pages) narrowed to the world, with the world screen's own filter.
import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PostFilterValue } from '../components/PostFilterSheet';
import { getFeedUseCase } from '../services/postsComposition';
import { useAuthStore } from '../store/authStore';
import {
  countWorldPostFilters,
  isWorldPostSearch,
  worldFeedFilter,
  worldPostFilterDefaults,
} from '../lib/worldPostFeed';
import { usePrefetchNextPage } from './usePrefetchNextPage';

const PAGE_SIZE = 20;

export function useWorldPostFeed(worldSlug: string) {
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const [value, setValue] = useState<PostFilterValue>(() => worldPostFilterDefaults(worldSlug));
  const filter = useMemo(() => worldFeedFilter(worldSlug, value), [worldSlug, value]);

  const query = useInfiniteQuery({
    queryKey: ['feed', viewerId, filter],
    queryFn: ({ pageParam }) =>
      getFeedUseCase().execute({ viewerId, filter, limit: PAGE_SIZE, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  usePrefetchNextPage(query);

  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.posts) ?? [], [query.data?.pages]);

  // The world stays the screen's own whatever the sheet sends.
  const patch = useCallback(
    (next: Partial<PostFilterValue>) => setValue((prev) => ({ ...prev, ...next, worlds: [worldSlug] })),
    [worldSlug],
  );
  const clear = useCallback(() => setValue(worldPostFilterDefaults(worldSlug)), [worldSlug]);
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const activeFilterCount = countWorldPostFilters(value);
  return {
    value,
    patch,
    clear,
    posts,
    activeFilterCount,
    refined: activeFilterCount > 0,
    searching: isWorldPostSearch(value),
    searchedQuery: value.searchQuery.trim(),
    hasMore: query.hasNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching && !query.isFetchingNextPage,
    isError: query.isError,
    refresh: () => void query.refetch(),
    loadMore,
  };
}

export type WorldPostFeedState = ReturnType<typeof useWorldPostFeed>;
