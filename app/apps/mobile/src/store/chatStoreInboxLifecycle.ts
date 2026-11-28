// Inbox load + Realtime wiring extracted from chatStore.ts (architecture LOC cap, TD-118).
import type { QueryClient } from '@tanstack/react-query';
import type { IChatRepository, IChatRealtime } from '@kc/application';
import type { ChatState } from './chatStoreTypes';
import { chatInboxQueryKey, readChatInboxSnapshot, writeChatInboxSnapshot } from '../lib/chatInboxQuery';
import { reduceBumpInboxForIncomingInsert } from './chatStoreInboxBump';
import { runRefreshInbox } from './chatStoreInboxRefresh';
import { useActiveScreenStore } from '../lib/notifications/useActiveScreenStore';
import { reportHandledError } from '../lib/observability/reportHandledError';

type StoreApi = {
  getState: () => ChatState;
  setState: (partial: Partial<ChatState>) => void;
};

/**
 * Loads the inbox once and opens its realtime subscription (FR-CHAT-001). `noopUnsub` is the
 * placeholder the store holds while this runs: if it was replaced meanwhile (sign-out, a second
 * start), the work is abandoned so only one subscription ever lives.
 */
export async function runStartInboxSub(
  api: StoreApi,
  noopUnsub: () => void,
  userId: string,
  repo: IChatRepository,
  realtime: IChatRealtime,
  qc: QueryClient,
): Promise<void> {
  // The first snapshot is a head start, not a precondition: when it fails (a timeout at sign-in,
  // KC#2213) the live subscription must still start, or the member gets no inbox updates for the
  // whole session. The inbox query is marked stale so its own retry policy loads the list.
  try {
    await runRefreshInbox(api, userId, repo, qc);
  } catch (error) {
    reportHandledError(error, 'manual', chatInboxQueryKey(userId));
    void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
  }

  if (api.getState().inboxSub !== noopUnsub) {
    return;
  }

  const unsub = realtime.subscribeToInbox(
    userId,
    {
      // The topic carries ids only: refresh the inbox from the server (`chat_inbox_page`).
      onInboxChanged: () => {
        void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
      },
      onUnreadTotalChanged: (total) => {
        api.setState({ unreadTotal: total });
        const snap = readChatInboxSnapshot(qc, userId);
        if (snap) {
          // Badge-only data cannot make a stale conversation preview fresh. A delayed
          // unread RPC follows chat_updated and setQueryData clears isInvalidated.
          const key = chatInboxQueryKey(userId);
          const wasInvalidated = qc.getQueryState(key)?.isInvalidated;
          writeChatInboxSnapshot(qc, userId, { ...snap, unreadTotal: total });
          if (wasInvalidated) void qc.invalidateQueries({ queryKey: key, refetchType: 'none' });
        }
        else void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
      },
      // A dropped channel may have missed events: the inbox is refetched on its next read, and the
      // adapter reports a change once the channel is back (#1778). Transient drops are not errors
      // worth reporting.
      onError: () => {
        void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
      },
      onInboxMessageInsert: (message) => {
        const activeRoute = useActiveScreenStore.getState().route;
        const isActiveChat = activeRoute === `/chat/${message.chatId}`;
        const snap = readChatInboxSnapshot(qc, userId);
        if (!snap) {
          void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
          return;
        }
        const next = reduceBumpInboxForIncomingInsert(snap, userId, message, isActiveChat);
        if (next) {
          writeChatInboxSnapshot(qc, userId, next);
          api.setState({ unreadTotal: next.unreadTotal });
        }
      },
    },
    { getSnapshotEpoch: () => api.getState().inboxSnapshotEpoch },
  );

  if (api.getState().inboxSub !== noopUnsub) {
    unsub();
    return;
  }

  api.setState({ inboxSub: unsub });
}

export { runRefreshInbox } from './chatStoreInboxRefresh';
