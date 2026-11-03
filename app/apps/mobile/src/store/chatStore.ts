// FR-CHAT-001..013, FR-CHAT-016 — Zustand store for threads + realtime lifecycle; inbox in React Query.
import { create } from 'zustand';
import type { Message, Chat } from '@kc/domain';
import type { ChatState, OptimisticMessage } from './chatStoreTypes';
import { runRefreshInbox, runStartInboxSub } from './chatStoreInboxLifecycle';
import { useAuthStore } from './authStore';
import { queryClient } from '../lib/queryPersist';
import {
  chatInboxQueryKey,
  readChatInboxSnapshot,
  upsertChatPreviewInSnapshot,
  isChatInSnapshot,
  markChatReadInSnapshot,
  writeChatInboxSnapshot,
} from '../lib/chatInboxQuery';
import { reduceBumpInboxForIncomingInsert } from './chatStoreInboxBump';
import { useActiveScreenStore } from '../lib/notifications/useActiveScreenStore';

export type { OptimisticMessage } from './chatStoreTypes';

const compareCreatedAt = (a: { createdAt: string }, b: { createdAt: string }) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt);

const toOptimistic = (m: Message): OptimisticMessage => ({ ...m, clientId: m.messageId });

function inboxUserId(): string | null {
  return useAuthStore.getState().session?.userId ?? null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  unreadTotal: 0,
  inboxSnapshotEpoch: 0,
  threads: {},
  inboxSub: null,
  threadSubs: {},

  upsertChatPreview: (chat: Chat) => {
    const userId = inboxUserId();
    if (!userId) return;
    const snap = readChatInboxSnapshot(queryClient, userId);
    if (!snap) {
      void queryClient.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
      return;
    }
    const isNew = !isChatInSnapshot(snap, chat.chatId);
    writeChatInboxSnapshot(queryClient, userId, upsertChatPreviewInSnapshot(snap, chat));
    if (isNew) void queryClient.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
  },

  setUnreadTotal: (n) => set({ unreadTotal: n }),

  markChatLocallyRead: (chatId) =>
    set((s) => {
      const userId = inboxUserId();
      if (!userId) return s;
      const snap = readChatInboxSnapshot(queryClient, userId);
      if (!snap) return s;
      const patched = markChatReadInSnapshot(snap, chatId);
      if (!patched) return s;
      writeChatInboxSnapshot(queryClient, userId, patched.snapshot);
      return {
        unreadTotal: patched.snapshot.unreadTotal,
        inboxSnapshotEpoch: s.inboxSnapshotEpoch + 1,
      };
    }),

  bumpInboxForIncomingInsert: (viewerId, msg) =>
    set((s) => {
      const userId = inboxUserId();
      if (!userId) return s;
      const snap = readChatInboxSnapshot(queryClient, userId);
      if (!snap) return s;
      const activeRoute = useActiveScreenStore.getState().route;
      const isActiveChat = activeRoute === `/chat/${msg.chatId}`;
      const next = reduceBumpInboxForIncomingInsert(snap, viewerId, msg, isActiveChat);
      if (!next) return s;
      writeChatInboxSnapshot(queryClient, userId, next);
      return { ...s, unreadTotal: next.unreadTotal };
    }),

  setThreadMessages: (chatId, msgs) => {
    const next = msgs.map(toOptimistic).sort(compareCreatedAt);
    set((s) => ({ threads: { ...s.threads, [chatId]: next } }));
  },

  appendOptimistic: (chatId, msg) =>
    set((s) => ({
      threads: { ...s.threads, [chatId]: [...(s.threads[chatId] ?? []), msg] },
    })),

  reconcileSent: (chatId, clientId, server) =>
    set((s) => {
      const list = s.threads[chatId] ?? [];
      const next = list.map((m) =>
        m.clientId === clientId ? { ...server, clientId, failed: false } : m,
      );
      return { threads: { ...s.threads, [chatId]: next } };
    }),

  markFailed: (chatId, clientId) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [chatId]: (s.threads[chatId] ?? []).map((m) =>
          m.clientId === clientId ? { ...m, failed: true } : m,
        ),
      },
    })),

  applyIncomingMessage: (chatId, msg) =>
    set((s) => {
      const list = s.threads[chatId] ?? [];
      if (list.some((m) => m.messageId === msg.messageId)) return s;
      const optimisticIdx = list.findIndex(
        (m) => m.status === 'pending' && m.senderId === msg.senderId && m.body === msg.body,
      );
      if (optimisticIdx >= 0) {
        const next = list.map((m, i) =>
          i === optimisticIdx ? { ...msg, clientId: m.clientId, failed: false } : m,
        );
        return { threads: { ...s.threads, [chatId]: next } };
      }
      const next = [...list, toOptimistic(msg)].sort(compareCreatedAt);
      return { threads: { ...s.threads, [chatId]: next } };
    }),

  applyStatusChange: (chatId, patch) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [chatId]: (s.threads[chatId] ?? []).map((m) =>
          m.messageId === patch.messageId
            ? {
                ...m,
                status: patch.status,
                deliveredAt: patch.deliveredAt,
                readAt: patch.readAt,
              }
            : m,
        ),
      },
    })),

  startInboxSub: async (userId, repo, realtime) => {
    if (get().inboxSub) return;
    const noopUnsub = () => {};
    set({ inboxSub: noopUnsub });
    try {
      await runStartInboxSub(
        { getState: get, setState: set },
        noopUnsub,
        userId,
        repo,
        realtime,
        queryClient,
      );
    } catch (err) {
      if (get().inboxSub === noopUnsub) set({ inboxSub: null });
      throw err;
    }
  },

  startThreadSub: async (chatId, repo, realtime, onChatChanged) => {
    if (get().threadSubs[chatId]) return;
    const noopUnsub = () => {};
    set((s) => ({ threadSubs: { ...s.threadSubs, [chatId]: noopUnsub } }));
    try {
      const msgs = await repo.getMessages(chatId, 50);
      if (get().threadSubs[chatId] !== noopUnsub) return;
      get().setThreadMessages(chatId, msgs);
      const unsub = realtime.subscribeToChat(chatId, {
        onMessage: (m) => get().applyIncomingMessage(chatId, m),
        onMessageStatusChanged: (p) => get().applyStatusChange(chatId, p),
        onChatChanged,
        onError: () => { /* deferred: surface via ChatChannelStatus hook */ },
      });
      set((s) => ({ threadSubs: { ...s.threadSubs, [chatId]: unsub } }));
    } catch (err) {
      set((s) => {
        if (s.threadSubs[chatId] !== noopUnsub) return s;
        const { [chatId]: _, ...rest } = s.threadSubs;
        return { threadSubs: rest };
      });
      throw err;
    }
  },

  stopThreadSub: (chatId) =>
    set((s) => {
      const unsub = s.threadSubs[chatId];
      if (unsub) unsub();
      const { [chatId]: _removed, ...rest } = s.threadSubs;
      return { threadSubs: rest };
    }),

  refreshInbox: async (userId, repo) =>
    runRefreshInbox({ getState: get, setState: set }, userId, repo, queryClient),

  resetOnSignOut: () => {
    const s = get();
    const userId = inboxUserId();
    if (s.inboxSub) s.inboxSub();
    Object.values(s.threadSubs).forEach((u) => u());
    if (userId) queryClient.removeQueries({ queryKey: chatInboxQueryKey(userId) });
    set({
      unreadTotal: 0,
      inboxSnapshotEpoch: 0,
      threads: {},
      inboxSub: null,
      threadSubs: {},
    });
  },
}));
