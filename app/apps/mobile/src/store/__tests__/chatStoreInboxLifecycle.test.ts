import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Message } from '@kc/domain';
import type {
  ChatWithPreview,
  IChatRealtime,
  IChatRepository,
} from '@kc/application';
import { runStartInboxSub } from '../chatStoreInboxLifecycle';
import { chatInboxQueryKey } from '../../lib/chatInboxQuery';

const CHAT: ChatWithPreview = {
  chatId: 'c_1', otherUser: { userId: 'u_1', displayName: 'A', shareHandle: 'a', avatarUrl: null, privacyMode: 'Public' },
  lastMessage: null, lastMessageAt: '2026-05-16T12:00:00.000Z', unreadCount: 0,
  ownerHiddenForViewer: false, anchorPostId: null, anchorPost: null,
} as never;

interface State {
  inboxSnapshotEpoch: number;
  unreadTotal: number;
  inboxSub: (() => void) | null;
}

function makeStoreApi(seed: Partial<State> = {}) {
  const state: State = {
    inboxSnapshotEpoch: 0,
    unreadTotal: 0,
    inboxSub: null,
    ...seed,
  };
  return {
    state,
    api: {
      getState: () => state,
      setState: (partial: Partial<State>) => Object.assign(state, partial),
    } as never,
  };
}

function makeRepo(): IChatRepository {
  return {
    getMyChats: () => Promise.resolve([CHAT]),
    getUnreadTotal: () => Promise.resolve(2),
  } as unknown as IChatRepository;
}

function makeRealtime(opts: {
  unsub?: () => void;
  capture?: (handlers: Record<string, (...args: unknown[]) => void>) => void;
} = {}): IChatRealtime {
  return {
    subscribeToInbox: (_userId: string, handlers: Record<string, (...args: unknown[]) => void>) => {
      opts.capture?.(handlers);
      return opts.unsub ?? (() => undefined);
    },
  } as unknown as IChatRealtime;
}

describe('runStartInboxSub', () => {
  it('fetches the snapshot, then subscribes and stores the unsub in inboxSub', async () => {
    const qc = new QueryClient();
    const noopUnsub = vi.fn();
    const realUnsub = vi.fn();
    const { state, api } = makeStoreApi({ inboxSub: noopUnsub });
    const realtime = makeRealtime({ unsub: realUnsub });

    await runStartInboxSub(api, noopUnsub, 'u_me', makeRepo(), realtime, qc);

    expect(qc.getQueryData(chatInboxQueryKey('u_me'))).toEqual({ chats: [CHAT], unreadTotal: 2 });
    expect(state.unreadTotal).toBe(2);
    expect(state.inboxSub).toBe(realUnsub);
  });

  it('bails early WITHOUT subscribing when inboxSub no longer matches noopUnsub after refresh', async () => {
    const qc = new QueryClient();
    const noopUnsub = vi.fn();
    const competingUnsub = vi.fn();
    const subscribeSpy = vi.fn();
    const { state, api } = makeStoreApi({ inboxSub: noopUnsub });
    const realtime: IChatRealtime = {
      subscribeToInbox: (() => {
        subscribeSpy();
        return () => undefined;
      }) as never,
    } as unknown as IChatRealtime;

    const repo: IChatRepository = {
      getMyChats: () => {
        state.inboxSub = competingUnsub;
        return Promise.resolve([CHAT]);
      },
      getUnreadTotal: () => Promise.resolve(2),
    } as unknown as IChatRepository;

    await runStartInboxSub(api, noopUnsub, 'u_me', repo, realtime, qc);

    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(state.inboxSub).toBe(competingUnsub);
  });

  it('unsubscribes the new sub when inboxSub changed during subscribe()', async () => {
    const qc = new QueryClient();
    const noopUnsub = vi.fn();
    const competingUnsub = vi.fn();
    const newSubUnsub = vi.fn();
    const { state, api } = makeStoreApi({ inboxSub: noopUnsub });

    const realtime: IChatRealtime = {
      subscribeToInbox: (() => {
        state.inboxSub = competingUnsub;
        return newSubUnsub;
      }) as never,
    } as unknown as IChatRealtime;

    await runStartInboxSub(api, noopUnsub, 'u_me', makeRepo(), realtime, qc);

    expect(newSubUnsub).toHaveBeenCalledTimes(1);
    expect(state.inboxSub).toBe(competingUnsub);
  });

  it('wires onInboxChanged → invalidates the inbox query (the topic carries ids only)', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const noopUnsub = vi.fn();
    let handlers: Record<string, (...args: unknown[]) => void> | null = null;
    const { api } = makeStoreApi({ inboxSub: noopUnsub });
    const realtime = makeRealtime({ capture: (h) => { handlers = h; } });

    await runStartInboxSub(api, noopUnsub, 'u_me', makeRepo(), realtime, qc);
    invalidate.mockClear();
    handlers!.onInboxChanged({ chatId: 'c_1', lastMessageAt: '2026-05-17T00:00:00.000Z' });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatInboxQueryKey('u_me') });
  });

  it('wires onUnreadTotalChanged → setState({ unreadTotal }) + cache', async () => {
    const qc = new QueryClient();
    const noopUnsub = vi.fn();
    let handlers: Record<string, (...args: unknown[]) => void> | null = null;
    const { state, api } = makeStoreApi({ inboxSub: noopUnsub });
    const realtime = makeRealtime({ capture: (h) => { handlers = h; } });

    await runStartInboxSub(api, noopUnsub, 'u_me', makeRepo(), realtime, qc);
    handlers!.onUnreadTotalChanged(42);

    expect(state.unreadTotal).toBe(42);
    expect(qc.getQueryData(chatInboxQueryKey('u_me'))).toMatchObject({ unreadTotal: 42 });
  });

  it('wires onInboxMessageInsert → cache bump', async () => {
    const qc = new QueryClient();
    const noopUnsub = vi.fn();
    let handlers: Record<string, (...args: unknown[]) => void> | null = null;
    const { state, api } = makeStoreApi({ inboxSub: noopUnsub });
    const realtime = makeRealtime({ capture: (h) => { handlers = h; } });

    await runStartInboxSub(api, noopUnsub, 'u_me', makeRepo(), realtime, qc);
    const msg: Message = {
      messageId: 'm_1',
      chatId: 'c_1',
      senderId: 'u_2',
      kind: 'user',
      body: 'ping',
      createdAt: '2026-05-18T00:00:00.000Z',
    } as never;
    handlers!.onInboxMessageInsert(msg);

    const snap = qc.getQueryData<{ chats: ChatWithPreview[]; unreadTotal: number }>(
      chatInboxQueryKey('u_me'),
    );
    expect(snap?.chats[0]?.lastMessage?.messageId).toBe('m_1');
    expect(snap?.unreadTotal).toBeGreaterThan(0);
    expect(state.unreadTotal).toBeGreaterThan(0);
  });
});
