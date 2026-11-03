// Inbox load + Realtime wiring extracted from chatStore.ts (architecture LOC cap, TD-118).
import type { QueryClient } from '@tanstack/react-query';
import type { IChatRepository, IChatRealtime } from '@kc/application';
import type { ChatState } from './chatStoreTypes';
import {
  chatInboxQueryKey,
  readChatInboxSnapshot,
  upsertChatPreviewInSnapshot,
  isChatInSnapshot,
  writeChatInboxSnapshot,
} from '../lib/chatInboxQuery';
import { reduceBumpInboxForIncomingInsert } from './chatStoreInboxBump';
import { runRefreshInbox } from './chatStoreInboxRefresh';
import { useActiveScreenStore } from '../lib/notifications/useActiveScreenStore';

type StoreApi = {
  getState: () => ChatState;
  setState: (partial: Partial<ChatState>) => void;
};

export async function runStartInboxSub(
  api: StoreApi,
  noopUnsub: () => void,
  userId: string,
  repo: IChatRepository,
  realtime: IChatRealtime,
  qc: QueryClient,
): Promise<void> {
  await runRefreshInbox(api, userId, repo, qc);

  if (api.getState().inboxSub !== noopUnsub) {
    return;
  }

  const unsub = realtime.subscribeToInbox(
    userId,
    {
      onChatChanged: (chat) => {
        const snap = readChatInboxSnapshot(qc, userId);
        if (!snap) {
          void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
          return;
        }
        const isNew = !isChatInSnapshot(snap, chat.chatId);
        const next = upsertChatPreviewInSnapshot(snap, chat);
        writeChatInboxSnapshot(qc, userId, next);
        if (isNew) void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
      },
      onUnreadTotalChanged: (total) => {
        api.setState({ unreadTotal: total });
        const snap = readChatInboxSnapshot(qc, userId);
        if (snap) writeChatInboxSnapshot(qc, userId, { ...snap, unreadTotal: total });
        else void qc.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
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
