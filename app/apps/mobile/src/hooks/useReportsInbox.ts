// app/apps/mobile/src/hooks/useReportsInbox.ts
// FR-ADMIN-012 — paginated, filtered admin reports inbox.
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReportInboxPage, ReportInboxCursor } from '@kc/domain';
import type { ListOpenReportsFilters } from '@kc/application';
import { container } from '../lib/container';
import { valueOrNull } from '../lib/backendAvailability';

const EMPTY_INBOX: ReportInboxPage = { rows: [], nextCursor: null };

export function useReportsInbox(filters: ListOpenReportsFilters) {
  return useInfiniteQuery<ReportInboxPage>({
    queryKey: ['admin.reports.inbox', filters],
    initialPageParam: null as ReportInboxCursor | null,
    // Degrade rule: a backend without the reports table shows an empty inbox.
    queryFn: async ({ pageParam }) =>
      (await valueOrNull(() =>
        container.listOpenReports.execute({
          filters,
          cursor: (pageParam as ReportInboxCursor | null) ?? null,
        }))) ?? EMPTY_INBOX,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
}
