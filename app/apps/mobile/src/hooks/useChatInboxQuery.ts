// FR-CHAT-001 — the inbox query (React Query, persisted offline-first).
import { useQuery } from '@tanstack/react-query';
import { container } from '../lib/container';
import { chatInboxQueryKey, fetchChatInboxSnapshot } from '../lib/chatInboxQuery';

export interface ChatInboxQueryOptions {
  /**
   * False while the inbox is not on screen (#2571). The query then has no active observer, so
   * the realtime invalidations that follow every message only mark it stale instead of running
   * `chat_inbox_page`; when it is subscribed again, one refetch catches up if it is stale.
   */
  readonly subscribed?: boolean;
}

export function useChatInboxQuery(userId: string | null | undefined, options: ChatInboxQueryOptions = {}) {
  return useQuery({
    queryKey: chatInboxQueryKey(userId ?? ''),
    queryFn: () => fetchChatInboxSnapshot(userId!, container.chatRepo),
    enabled: Boolean(userId),
    subscribed: options.subscribed ?? true,
  });
}
