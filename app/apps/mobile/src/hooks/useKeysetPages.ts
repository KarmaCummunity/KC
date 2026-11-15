// app/apps/mobile/src/hooks/useKeysetPages.ts
// A keyset-paged list of the back office (FR-ADMIN-018 tasks, FR-ADMIN-032 CRM contacts,
// FR-ADMIN-033 timesheets): the next page is requested with the `nextCursor` of the last one.
import { useInfiniteQuery } from '@tanstack/react-query';

interface KeysetPage<T> {
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
  /** Lists that report their total carry it on every page. */
  readonly totalCount?: number;
}

export interface KeysetPages<T> {
  readonly rows: readonly T[];
  readonly totalCount: number;
  readonly hasMore: boolean;
  /** Loads the next page; a no-op at the end or while one is loading. */
  readonly fetchMore: () => void;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly refetch: () => void;
  readonly error: unknown;
}

export function useKeysetPages<T, F extends object>(
  queryKey: readonly unknown[],
  filters: F,
  run: (filters: F & { readonly cursor?: string }) => Promise<KeysetPage<T>>,
  enabled = true,
): KeysetPages<T> {
  const q = useInfiniteQuery<KeysetPage<T>>({
    queryKey: [...queryKey, filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => run({ ...filters, cursor: (pageParam as string | null) ?? undefined }),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 15_000,
  });
  const pages = q.data?.pages ?? [];
  return {
    rows: pages.flatMap((page) => page.rows),
    totalCount: pages[0]?.totalCount ?? 0,
    hasMore: q.hasNextPage,
    fetchMore: () => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); },
    isLoading: q.isLoading,
    isRefetching: q.isRefetching && !q.isFetchingNextPage,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}
