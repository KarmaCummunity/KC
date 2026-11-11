import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatWithPreview } from '@kc/application';
import {
  chatInboxQueryKey,
  readChatInboxSnapshot,
  writeChatInboxSnapshot,
} from '../../lib/chatInboxQuery';

const auth = vi.hoisted(() => ({ userId: 'u_me' as string | null }));
vi.mock('../authStore', () => ({
  useAuthStore: {
    getState: () => ({ session: auth.userId ? { userId: auth.userId } : null }),
  },
}));

const lifecycle = vi.hoisted(() => ({
  runStartInboxSub: vi.fn(async () => undefined),
  runRefreshInbox: vi.fn(async () => undefined),
}));
vi.mock('../chatStoreInboxLifecycle', () => lifecycle);

const queryClient = new QueryClient();
vi.mock('../../lib/queryPersist', () => ({ queryClient }));

const { useChatStore } = await import('../chatStore');
const { useActiveScreenStore } = await import('../../lib/notifications/useActiveScreenStore');

const CHAT = {
  chatId: 'c1',
  lastMessageAt: '2026-05-16T12:00:00.000Z',
  unreadCount: 0,
} as ChatWithPreview;

const MSG = {
  messageId: 'm9',
  chatId: 'c1',
  senderId: 'u_other',
  body: 'hi',
  createdAt: '2026-05-16T13:00:00.000Z',
} as never;

function resetStore() {
  useChatStore.setState({
    unreadTotal: 0,
    inboxSnapshotEpoch: 0,
    threads: {},
    inboxSub: null,
    threadSubs: {},
  });
}

describe('useChatStore — inbox cache helpers', () => {
  beforeEach(() => {
    auth.userId = 'u_me';
    queryClient.clear();
    resetStore();
    vi.clearAllMocks();
  });

  it('upsertChatPreview is a no-op without a session', () => {
    auth.userId = null;
    useChatStore.getState().upsertChatPreview(CHAT);
    expect(readChatInboxSnapshot(queryClient, 'u_me')).toBeUndefined();
  });

  it('upsertChatPreview invalidates when no snapshot is cached', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    useChatStore.getState().upsertChatPreview(CHAT);
    expect(spy).toHaveBeenCalledWith({ queryKey: chatInboxQueryKey('u_me') });
    spy.mockRestore();
  });

  it('upsertChatPreview writes into an existing snapshot', () => {
    writeChatInboxSnapshot(queryClient, 'u_me', { chats: [], unreadTotal: 0 });
    useChatStore.getState().upsertChatPreview(CHAT);
    expect(readChatInboxSnapshot(queryClient, 'u_me')?.chats).toHaveLength(1);
  });

  it('setUnreadTotal sets the counter', () => {
    useChatStore.getState().setUnreadTotal(7);
    expect(useChatStore.getState().unreadTotal).toBe(7);
  });

  it('bumpInboxForIncomingInsert ignores missing session or snapshot', () => {
    auth.userId = null;
    useChatStore.getState().bumpInboxForIncomingInsert('u_me', MSG);
    auth.userId = 'u_me';
    useChatStore.getState().bumpInboxForIncomingInsert('u_me', MSG);
    expect(useChatStore.getState().unreadTotal).toBe(0);
  });

  it('bumpInboxForIncomingInsert increments unread for an inactive chat', () => {
    writeChatInboxSnapshot(queryClient, 'u_me', { chats: [CHAT], unreadTotal: 0 });
    useActiveScreenStore.setState({ route: '/somewhere' } as never);
    useChatStore.getState().bumpInboxForIncomingInsert('u_me', MSG);
    expect(useChatStore.getState().unreadTotal).toBe(1);
    expect(readChatInboxSnapshot(queryClient, 'u_me')?.unreadTotal).toBe(1);
  });

  it('bumpInboxForIncomingInsert is a no-op for unknown chats', () => {
    writeChatInboxSnapshot(queryClient, 'u_me', { chats: [], unreadTotal: 0 });
    useChatStore.getState().bumpInboxForIncomingInsert('u_me', MSG);
    expect(useChatStore.getState().unreadTotal).toBe(0);
  });
});

describe('useChatStore — thread mutations', () => {
  beforeEach(() => resetStore());

  it('appendOptimistic, reconcileSent and markFailed', () => {
    const s = useChatStore.getState();
    s.appendOptimistic('c1', { messageId: 'tmp', clientId: 'k1', body: 'a' } as never);
    s.markFailed('c1', 'k1');
    expect(useChatStore.getState().threads.c1?.[0]?.failed).toBe(true);
    s.reconcileSent('c1', 'k1', { messageId: 'm1', body: 'a' } as never);
    expect(useChatStore.getState().threads.c1?.[0]).toMatchObject({ messageId: 'm1', failed: false });
  });

  it('applyReadMarker marks others\' messages up to the marker as read and leaves the reader\'s own', () => {
    const s = useChatStore.getState();
    s.setThreadMessages('c1', [
      { messageId: 'old', senderId: 'u_me', status: 'delivered', createdAt: '2026-05-16T10:00:00.000Z' },
      { messageId: 'new', senderId: 'u_me', status: 'delivered', createdAt: '2026-05-16T12:00:00.000Z' },
      { messageId: 'theirs', senderId: 'u_other', status: 'delivered', createdAt: '2026-05-16T10:30:00.000Z' },
    ] as never);

    s.applyReadMarker('c1', { userId: 'u_other', lastReadAt: '2026-05-16T11:00:00.000Z' });

    const byId = Object.fromEntries((useChatStore.getState().threads.c1 ?? []).map((m) => [m.messageId, m]));
    expect(byId['old']).toMatchObject({ status: 'read', readAt: '2026-05-16T11:00:00.000Z' });
    expect(byId['new']).toMatchObject({ status: 'delivered' });
    expect(byId['theirs']).toMatchObject({ status: 'delivered' });
  });

  it('applyIncomingMessage replaces a matching pending optimistic row', () => {
    useChatStore.getState().appendOptimistic('c1', {
      messageId: 'tmp', clientId: 'k1', status: 'pending', senderId: 'u_other', body: 'hi',
      createdAt: '2026-05-16T13:00:00.000Z',
    } as never);
    useChatStore.getState().applyIncomingMessage('c1', MSG);
    const list = useChatStore.getState().threads.c1 ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ messageId: 'm9', clientId: 'k1' });
  });

  it('applyIncomingMessage appends a new message', () => {
    useChatStore.getState().applyIncomingMessage('c1', MSG);
    expect(useChatStore.getState().threads.c1).toHaveLength(1);
  });
});

describe('useChatStore — subscriptions lifecycle', () => {
  beforeEach(() => {
    auth.userId = 'u_me';
    queryClient.clear();
    resetStore();
    vi.clearAllMocks();
  });

  it('startInboxSub delegates once and is idempotent', async () => {
    await useChatStore.getState().startInboxSub('u_me', {} as never, {} as never);
    await useChatStore.getState().startInboxSub('u_me', {} as never, {} as never);
    expect(lifecycle.runStartInboxSub).toHaveBeenCalledTimes(1);
  });

  it('startInboxSub clears the placeholder on failure', async () => {
    lifecycle.runStartInboxSub.mockRejectedValueOnce(new Error('boom'));
    await expect(
      useChatStore.getState().startInboxSub('u_me', {} as never, {} as never),
    ).rejects.toThrow('boom');
    expect(useChatStore.getState().inboxSub).toBeNull();
  });

  it('startThreadSub loads messages, subscribes and stopThreadSub unsubscribes', async () => {
    const unsub = vi.fn();
    const repo = { getMessages: vi.fn(async () => [MSG]) };
    let handlers: Record<string, (x: unknown) => void> = {};
    const realtime = {
      subscribeToChat: vi.fn((_id: string, h: Record<string, (x: unknown) => void>) => {
        handlers = h;
        return unsub;
      }),
    };
    await useChatStore.getState().startThreadSub('c1', repo as never, realtime as never, vi.fn());
    await useChatStore.getState().startThreadSub('c1', repo as never, realtime as never, vi.fn());
    expect(repo.getMessages).toHaveBeenCalledTimes(1);
    handlers.onMessage?.({ ...(MSG as object), messageId: 'm10' });
    handlers.onReadMarker?.({ userId: 'u_other', lastReadAt: '2026-05-16T13:00:00.000Z' });
    handlers.onError?.(new Error('x'));
    expect(useChatStore.getState().threads.c1).toHaveLength(2);
    useChatStore.getState().stopThreadSub('c1');
    expect(unsub).toHaveBeenCalled();
    expect(useChatStore.getState().threadSubs.c1).toBeUndefined();
  });

  it('startThreadSub removes the placeholder when loading fails', async () => {
    const repo = { getMessages: vi.fn(async () => { throw new Error('net'); }) };
    await expect(
      useChatStore.getState().startThreadSub('c1', repo as never, {} as never, vi.fn()),
    ).rejects.toThrow('net');
    expect(useChatStore.getState().threadSubs.c1).toBeUndefined();
  });

  it('refreshInbox delegates to the lifecycle helper', async () => {
    await useChatStore.getState().refreshInbox('u_me', {} as never);
    expect(lifecycle.runRefreshInbox).toHaveBeenCalledTimes(1);
  });

  it('resetOnSignOut tears down subs and drops the cached inbox', () => {
    const inboxUnsub = vi.fn();
    const threadUnsub = vi.fn();
    writeChatInboxSnapshot(queryClient, 'u_me', { chats: [CHAT], unreadTotal: 2 });
    useChatStore.setState({ inboxSub: inboxUnsub, threadSubs: { c1: threadUnsub }, unreadTotal: 2 });
    useChatStore.getState().resetOnSignOut();
    expect(inboxUnsub).toHaveBeenCalled();
    expect(threadUnsub).toHaveBeenCalled();
    expect(readChatInboxSnapshot(queryClient, 'u_me')).toBeUndefined();
    expect(useChatStore.getState().unreadTotal).toBe(0);
  });
});
