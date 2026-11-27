// FR-CHAT-003 — applyIncomingMessage optimistic reconciliation (#1778 clientId gate).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../authStore', () => ({
  useAuthStore: {
    getState: () => ({ session: { userId: 'u_me' } }),
  },
}));

vi.mock('../chatStoreInboxLifecycle', () => ({
  runStartInboxSub: vi.fn(async () => undefined),
  runRefreshInbox: vi.fn(async () => undefined),
}));

const queryClient = new QueryClient();
vi.mock('../../lib/queryPersist', () => ({ queryClient }));

const { useChatStore } = await import('../chatStore');

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

describe('useChatStore — applyIncomingMessage reconciliation', () => {
  beforeEach(() => resetStore());

  it('replaces a matching pending optimistic row by clientId', () => {
    useChatStore.getState().appendOptimistic('c1', {
      messageId: 'tmp', clientId: 'm9', status: 'pending', senderId: 'u_other', body: 'hi',
      createdAt: '2026-05-16T13:00:00.000Z',
    } as never);
    useChatStore.getState().applyIncomingMessage('c1', MSG);
    const list = useChatStore.getState().threads.c1 ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ messageId: 'm9', clientId: 'm9' });
  });

  it('reconciles two same-body pendings by clientId', () => {
    const s = useChatStore.getState();
    // Temp messageIds (≠ clientId) so the echo is not short-circuited by messageId dedupe;
    // both share body "hi" — the old senderId+body match would reconcile the wrong row.
    s.appendOptimistic('c1', {
      messageId: 'tmp-1', clientId: 'k1', status: 'pending', senderId: 'u_me', body: 'hi',
      createdAt: '2026-05-16T13:00:00.000Z',
    } as never);
    s.appendOptimistic('c1', {
      messageId: 'tmp-2', clientId: 'k2', status: 'pending', senderId: 'u_me', body: 'hi',
      createdAt: '2026-05-16T13:00:01.000Z',
    } as never);

    // Echo for the second send arrives first — must not steal the first pending.
    s.applyIncomingMessage('c1', {
      messageId: 'k2', chatId: 'c1', senderId: 'u_me', body: 'hi', status: 'delivered',
      createdAt: '2026-05-16T13:00:01.000Z',
    } as never);
    s.applyIncomingMessage('c1', {
      messageId: 'k1', chatId: 'c1', senderId: 'u_me', body: 'hi', status: 'delivered',
      createdAt: '2026-05-16T13:00:00.000Z',
    } as never);

    const list = useChatStore.getState().threads.c1 ?? [];
    expect(list).toHaveLength(2);
    expect(list.map((m) => ({ messageId: m.messageId, clientId: m.clientId, status: m.status }))).toEqual([
      { messageId: 'k1', clientId: 'k1', status: 'delivered' },
      { messageId: 'k2', clientId: 'k2', status: 'delivered' },
    ]);
  });

  it('falls back to body match when pending has no clientId', () => {
    useChatStore.getState().appendOptimistic('c1', {
      messageId: 'tmp', status: 'pending', senderId: 'u_other', body: 'hi',
      createdAt: '2026-05-16T13:00:00.000Z',
    } as never);
    useChatStore.getState().applyIncomingMessage('c1', MSG);
    const list = useChatStore.getState().threads.c1 ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ messageId: 'm9', body: 'hi', failed: false });
  });

  it('appends a new message when nothing pending matches', () => {
    useChatStore.getState().applyIncomingMessage('c1', MSG);
    expect(useChatStore.getState().threads.c1).toHaveLength(1);
  });
});
