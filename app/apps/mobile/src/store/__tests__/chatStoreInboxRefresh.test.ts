import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatWithPreview, IChatRepository } from '@kc/application';
import { runRefreshInbox } from '../chatStoreInboxRefresh';
import { chatInboxQueryKey } from '../../lib/chatInboxQuery';

interface MinimalState {
  inboxSnapshotEpoch: number;
  unreadTotal: number;
}

function makeStoreApi(initialEpoch: number) {
  const state: MinimalState = {
    inboxSnapshotEpoch: initialEpoch,
    unreadTotal: 0,
  };
  const sets: Array<Partial<MinimalState>> = [];
  const api = {
    getState: () => state,
    setState: (partial: Partial<MinimalState>) => {
      Object.assign(state, partial);
      sets.push(partial);
    },
  };
  return { state, sets, api: api as never };
}

const CHAT: ChatWithPreview = {
  chatId: 'c_1', otherUser: { userId: 'u_1', displayName: 'A', shareHandle: 'a', avatarUrl: null, privacyMode: 'Public' },
  lastMessage: null, lastMessageAt: '2026-05-16T12:00:00.000Z', unreadCount: 0,
  ownerHiddenForViewer: false, anchorPostId: null, anchorPost: null,
} as never;

function makeRepo(opts: {
  getMyChatsImpl?: () => Promise<ChatWithPreview[]>;
  getUnreadTotalImpl?: () => Promise<number>;
} = {}): IChatRepository {
  return {
    getMyChats: opts.getMyChatsImpl ?? (() => Promise.resolve([])),
    getUnreadTotal: opts.getUnreadTotalImpl ?? (() => Promise.resolve(0)),
  } as unknown as IChatRepository;
}

describe('runRefreshInbox (FR-CHAT-012 epoch guard)', () => {
  it('fetches chats + unread total in parallel and writes them when epoch is unchanged', async () => {
    const qc = new QueryClient();
    const { state, sets, api } = makeStoreApi(7);
    const repo = makeRepo({
      getMyChatsImpl: () => Promise.resolve([CHAT]),
      getUnreadTotalImpl: () => Promise.resolve(3),
    });
    await runRefreshInbox(api, 'u_me', repo, qc);
    expect(qc.getQueryData(chatInboxQueryKey('u_me'))).toEqual({ chats: [CHAT], unreadTotal: 3 });
    expect(state.unreadTotal).toBe(3);
    expect(sets).toEqual([{ unreadTotal: 3 }]);
  });

  it('DROPS the write when inboxSnapshotEpoch advanced between fetch and write (stale snapshot)', async () => {
    const qc = new QueryClient();
    const { state, sets, api } = makeStoreApi(1);
    const repo = makeRepo({
      getMyChatsImpl: () =>
        new Promise<ChatWithPreview[]>((resolve) => {
          setTimeout(() => {
            state.inboxSnapshotEpoch = 2;
            resolve([CHAT]);
          }, 0);
        }),
    });
    await runRefreshInbox(api, 'u_me', repo, qc);
    expect(sets).toEqual([]);
    expect(qc.getQueryData(chatInboxQueryKey('u_me'))).toBeUndefined();
  });

  it('issues exactly one getMyChats and one getUnreadTotal call (in parallel)', async () => {
    const qc = new QueryClient();
    const myChats = vi.fn(() => Promise.resolve([] as ChatWithPreview[]));
    const unread = vi.fn(() => Promise.resolve(0));
    const repo = makeRepo({ getMyChatsImpl: myChats, getUnreadTotalImpl: unread });
    const { api } = makeStoreApi(0);
    await runRefreshInbox(api, 'u_me', repo, qc);
    expect(myChats).toHaveBeenCalledTimes(1);
    expect(unread).toHaveBeenCalledTimes(1);
  });

  it('propagates a repo error (no error swallowing — caller decides retry/UX)', async () => {
    const qc = new QueryClient();
    const { api } = makeStoreApi(0);
    const repo = makeRepo({
      getMyChatsImpl: () => Promise.reject(new Error('rls denied')),
    });
    await expect(runRefreshInbox(api, 'u_me', repo, qc)).rejects.toThrow('rls denied');
  });
});
