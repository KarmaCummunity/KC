// app/apps/mobile/src/hooks/useAdminContentSearch.ts
// FR-ADMIN-019 / FR-ADMIN-020 — admin content search hooks (users, posts, audit).
// Each search pages by keyset: the next page is requested with the `nextCursor` of the last one.
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  AdminAuditRow, AdminPostSearchResult, AdminSearchCursor, AdminSearchPage, AdminUserSearchResult,
} from '@kc/domain';
import type {
  AdminAuditSearchFilters, AdminPostSearchFilters, AdminUserSearchFilters,
} from '@kc/application';
import { container } from '../lib/container';
import { valueOrNull } from '../lib/backendAvailability';

const EMPTY_PAGE = { rows: [], nextCursor: null } as const;

interface KeysetSearch<T> {
  readonly rows: readonly T[];
  /** True while a further page exists; the total is then unknown. */
  readonly hasMore: boolean;
  readonly fetchMore: () => void;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly refetch: () => void;
  readonly error: unknown;
}

/** One keyset-paged admin search. An unavailable backend reads as an empty result (degrade rule). */
function useKeysetSearch<T, F extends { readonly cursor?: AdminSearchCursor | null }>(
  queryKey: string,
  filters: Omit<F, 'cursor'>,
  run: (filters: F) => Promise<AdminSearchPage<T>>,
): KeysetSearch<T> {
  const q = useInfiniteQuery<AdminSearchPage<T>>({
    queryKey: [queryKey, filters],
    initialPageParam: null as AdminSearchCursor | null,
    queryFn: async ({ pageParam }) =>
      (await valueOrNull(() => run({ ...filters, cursor: pageParam as AdminSearchCursor | null } as F)))
      ?? EMPTY_PAGE,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
  return {
    rows:         q.data?.pages.flatMap((p) => p.rows) ?? [],
    hasMore:      q.hasNextPage,
    fetchMore:    () => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); },
    isLoading:    q.isLoading,
    isRefetching: q.isRefetching && !q.isFetchingNextPage,
    refetch:      () => { void q.refetch(); },
    error:        q.error,
  };
}

export function useAdminUserSearch(filters: Omit<AdminUserSearchFilters, 'cursor'>): KeysetSearch<AdminUserSearchResult> {
  return useKeysetSearch<AdminUserSearchResult, AdminUserSearchFilters>(
    'admin.search.users', filters, (f) => container.adminSearchUsers.execute(f),
  );
}

export function useAdminPostSearch(filters: Omit<AdminPostSearchFilters, 'cursor'>): KeysetSearch<AdminPostSearchResult> {
  return useKeysetSearch<AdminPostSearchResult, AdminPostSearchFilters>(
    'admin.search.posts', filters, (f) => container.adminSearchPosts.execute(f),
  );
}

export function useAdminAuditSearch(filters: Omit<AdminAuditSearchFilters, 'cursor'>): KeysetSearch<AdminAuditRow> {
  return useKeysetSearch<AdminAuditRow, AdminAuditSearchFilters>(
    'admin.search.audit', filters, (f) => container.adminSearchAudit.execute(f),
  );
}
