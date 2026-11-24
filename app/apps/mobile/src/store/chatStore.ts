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
import { withLoadedReactions, withNewMessages, withReactionChange } from './chatStoreReactions';

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
  reactions: {},
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

  // A message created on this device has no reactions yet (#2568): known as empty, never read.
  appendOptimistic: (chatId, msg) =>
    set((s) => ({
      threads: { ...s.threads, [chatId]: [...(s.threads[chatId] ?? []), msg] },
      reactions: { ...s.reactions, [chatId]: withNewMessages(s.reactions[chatId], [msg.messageId]) },
    })),

  reconcileSent: (chatId, clientId, server) =>
    set((s) => {
      const list = s.threads[chatId] ?? [];
      const next = list.map((m) =>
        m.clientId === clientId ? { ...server, clientId, failed: false } : m,
      );
      return {
        threads: { ...s.threads, [chatId]: next },
        reactions: { ...s.reactions, [chatId]: withNewMessages(s.reactions[chatId], [server.messageId]) },
      };
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
      // A live message is new: its reactions start empty and arrive as broadcasts (#2568).
      const reactions = { ...s.reactions, [chatId]: withNewMessages(s.reactions[chatId], [msg.messageId]) };
      const optimisticIdx = list.findIndex(
        (m) => m.status === 'pending' && m.senderId === msg.senderId && m.body === msg.body,
      );
      if (optimisticIdx >= 0) {
        const next = list.map((m, i) =>
          i === optimisticIdx ? { ...msg, clientId: m.clientId, failed: false } : m,
        );
        return { threads: { ...s.threads, [chatId]: next }, reactions };
      }
      const next = [...list, toOptimistic(msg)].sort(compareCreatedAt);
      return { threads: { ...s.threads, [chatId]: next }, reactions };
    }),

  applyReadMarker: (chatId, marker) =>
    set((s) => {
      const markerMs = Date.parse(marker.lastReadAt);
      return {
        threads: {
          ...s.threads,
          [chatId]: (s.threads[chatId] ?? []).map((m) =>
            // A member's marker reads everything sent by others up to it (FR-CHAT-011).
            m.senderId !== marker.userId && m.status !== 'read' && Date.parse(m.createdAt) <= markerMs
              ? { ...m, status: 'read', readAt: marker.lastReadAt }
              : m,
          ),
        },
      };
    }),

  setMessageReactions: (chatId, messageIds, rows) =>
    set((s) => ({
      reactions: { ...s.reactions, [chatId]: withLoadedReactions(s.reactions[chatId], messageIds, rows) },
    })),

  applyReactionChange: (chatId, change) =>
    set((s) => {
      const current = s.reactions[chatId];
      const next = withReactionChange(current, change);
      return next === current || !next ? s : { reactions: { ...s.reactions, [chatId]: next } };
    }),

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
      // Reactions cached from an earlier visit missed the changes made while it was closed:
      // forget them, so the page's reactions are read once, fresh (#2568).
      set((s) => ({ reactions: { ...s.reactions, [chatId]: {} } }));
      const userId = inboxUserId();
      let unsub = noopUnsub;
      unsub = realtime.subscribeToChat(chatId, {
        onMessage: (m) => get().applyIncomingMessage(chatId, m),
        onReadMarker: (marker) => get().applyReadMarker(chatId, marker),
        onChatChanged,
        onReaction: (change) => get().applyReactionChange(chatId, change),
        onError: () => { /* deferred: surface via ChatChannelStatus hook */ },
        // The channel rejoined after a failure (#1778): merge the latest page so messages sent
        // while it was down appear, without dropping pending sends or older loaded pages.
        onResync: () => {
          const isCurrent = () => get().threadSubs[chatId] === unsub && inboxUserId() === userId;
          if (!isCurrent()) return;
          void repo
            .getMessages(chatId, 50)
            .then((latest) => {
              if (!isCurrent()) return;
              latest.forEach((m) => get().applyIncomingMessage(chatId, m));
              // Reaction broadcasts sent while the channel was down are lost too: re-read them.
              set((s) => ({ reactions: { ...s.reactions, [chatId]: {} } }));
            })
            .catch(() => undefined);
        },
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
      reactions: {},
      inboxSub: null,
      threadSubs: {},
    });
  },
}));
