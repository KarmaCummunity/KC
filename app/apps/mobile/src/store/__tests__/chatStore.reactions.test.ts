// #2568 — message reactions in the chat store: what becomes known, what is forgotten, and the
// realtime wiring of the `reaction` broadcast.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ session: { userId: 'u_me' } }) } }));
vi.mock('../chatStoreInboxLifecycle', () => ({ runStartInboxSub: vi.fn(), runRefreshInbox: vi.fn() }));
vi.mock('../../lib/queryPersist', () => ({ queryClient: new QueryClient() }));

const { useChatStore } = await import('../chatStore');

const MSG = { messageId: 'm1', chatId: 'c1', senderId: 'u_other', body: 'hi', createdAt: '2026-11-21T10:00:00.000Z' } as never;
const LATE = { messageId: 'm2', chatId: 'c1', senderId: 'u_other', body: 'yo', createdAt: '2026-11-21T10:05:00.000Z' } as never;

/** Starts the thread over a fake channel and returns the callbacks the store registered. */
async function openThread(getMessages = vi.fn(async () => [MSG])) {
  let handlers: Record<string, (x?: unknown) => void> = {};
  const realtime = {
    subscribeToChat: vi.fn((_id: string, h: Record<string, (x?: unknown) => void>) => {
      handlers = h;
      return vi.fn();
    }),
  };
  await useChatStore.getState().startThreadSub('c1', { getMessages } as never, realtime as never, vi.fn());
  return { handlers: () => handlers, getMessages };
}

describe('useChatStore — message reactions', () => {
  beforeEach(() => {
    useChatStore.setState({ threads: {}, reactions: {}, threadSubs: {} });
  });

  it('forgets reactions cached from an earlier visit when the thread opens', async () => {
    useChatStore.setState({ reactions: { c1: { m1: { u_other: 'like' } } } });
    await openThread();
    expect(useChatStore.getState().reactions.c1).toEqual({});
  });

  it('applies a reaction broadcast to a known message', async () => {
    const { handlers } = await openThread();
    useChatStore.getState().setMessageReactions('c1', ['m1'], []);
    handlers().onReaction?.({ messageId: 'm1', userId: 'u_other', reactionType: 'love' });
    expect(useChatStore.getState().reactions.c1).toEqual({ m1: { u_other: 'love' } });
  });

  it('marks sent, reconciled and received messages as known with no reactions', async () => {
    const { handlers } = await openThread();
    const store = useChatStore.getState();
    store.appendOptimistic('c1', { messageId: 'k1', clientId: 'k1', status: 'pending', body: 'a' } as never);
    store.reconcileSent('c1', 'k1', { messageId: 's1', body: 'a' } as never);
    handlers().onMessage?.(LATE);
    expect(useChatStore.getState().reactions.c1).toEqual({ k1: {}, s1: {}, m2: {} });
  });

  it('forgets the reactions after a resync, so the page is re-read once', async () => {
    const getMessages = vi.fn().mockResolvedValueOnce([MSG]).mockResolvedValueOnce([MSG, LATE]);
    const { handlers } = await openThread(getMessages);
    useChatStore.getState().setMessageReactions('c1', ['m1'], [{ messageId: 'm1', userId: 'u_other', reactionType: 'like' }]);

    handlers().onResync?.();
    await vi.waitFor(() => expect(useChatStore.getState().threads.c1).toHaveLength(2));
    expect(useChatStore.getState().reactions.c1).toEqual({});
  });

  it('drops every chat reaction on sign-out', async () => {
    await openThread();
    useChatStore.getState().setMessageReactions('c1', ['m1'], []);
    useChatStore.getState().resetOnSignOut();
    expect(useChatStore.getState().reactions).toEqual({});
  });
});
