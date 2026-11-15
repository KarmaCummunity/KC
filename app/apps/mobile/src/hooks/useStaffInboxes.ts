// FR-CHAT-007 / FR-MOD-002 — the staff support inbox; FR-MOD-008 — the review queue. Both are
// keyset-paged lists of the admin portal; a backend without them shows an empty list.
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  ModerationQueueCursor, ModerationQueuePage, SupportThreadCursor, SupportThreadPage,
} from '@kc/application';
import { container } from '../lib/container';
import { valueOrNull } from '../lib/backendAvailability';

export const SUPPORT_INBOX_QUERY_KEY = 'admin.support.inbox';
export const REVIEW_QUEUE_QUERY_KEY = 'admin.review.queue';

const EMPTY_THREADS: SupportThreadPage = { threads: [], nextCursor: null };
const EMPTY_QUEUE: ModerationQueuePage = { entries: [], nextCursor: null };

export function useSupportInbox(enabled: boolean) {
  return useInfiniteQuery<SupportThreadPage>({
    queryKey: [SUPPORT_INBOX_QUERY_KEY],
    initialPageParam: null as SupportThreadCursor | null,
    queryFn: async ({ pageParam }) =>
      (await valueOrNull(() =>
        container.listSupportThreads.execute((pageParam as SupportThreadCursor | null) ?? null))) ?? EMPTY_THREADS,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 30_000,
  });
}

export function useReviewQueue(enabled: boolean) {
  return useInfiniteQuery<ModerationQueuePage>({
    queryKey: [REVIEW_QUEUE_QUERY_KEY],
    initialPageParam: null as ModerationQueueCursor | null,
    queryFn: async ({ pageParam }) =>
      (await valueOrNull(() =>
        container.listModerationQueue.execute((pageParam as ModerationQueueCursor | null) ?? null))) ?? EMPTY_QUEUE,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 30_000,
  });
}
