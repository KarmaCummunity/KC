// @vitest-environment jsdom
// #2566 — opening a conversation: seeded first frame, parallel requests, not-found handling.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Chat } from '@kc/domain';
import type { ChatWithPreview } from '@kc/application';

const m = vi.hoisted(() => ({
  findById: vi.fn(),
  getCounterpart: vi.fn(),
  startThreadSub: vi.fn(),
  stopThreadSub: vi.fn(),
  snapshot: undefined as unknown,
  report: vi.fn(),
}));

vi.mock('../../lib/container', () => ({
  container: {
    chatRepo: { findById: m.findById, getCounterpart: m.getCounterpart },
    chatRealtime: {},
  },
}));
vi.mock('../../store/chatStore', () => ({
  useChatStore: { getState: () => ({ startThreadSub: m.startThreadSub, stopThreadSub: m.stopThreadSub }) },
}));
vi.mock('../../lib/queryPersist', () => ({ queryClient: {} }));
vi.mock('../../lib/chatInboxQuery', () => ({ readChatInboxSnapshot: () => m.snapshot }));
vi.mock('../../lib/observability/reportHandledError', () => ({ reportHandledError: m.report }));

import { useChatInit } from '../useChatInit';

const CHAT: Chat = {
  chatId: 'c1',
  participantIds: ['me', 'peer'],
  anchorPostId: null,
  isSupportThread: false,
  lastMessageAt: '2026-11-20T10:00:00.000Z',
  createdAt: '2026-11-19T10:00:00.000Z',
};

const INBOX_ROW: ChatWithPreview = {
  ...CHAT,
  otherParticipant: { userId: 'peer', displayName: 'Dana', avatarUrl: null, shareHandle: 'dana', isDeleted: false },
  lastMessage: null,
  unreadCount: 0,
};

const SERVER_COUNTERPART = {
  userId: 'peer',
  displayName: 'Dana R.',
  avatarUrl: null,
  shareHandle: 'dana',
  isDeleted: false,
  verificationLevel: 0,
};

/** A promise the test resolves by hand, to observe what runs before a response arrives. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useChatInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.snapshot = undefined;
    m.startThreadSub.mockResolvedValue(undefined);
  });

  it('paints a chat from the inbox at once and revalidates chat, counterpart and messages in parallel', async () => {
    m.snapshot = { chats: [INBOX_ROW], unreadTotal: 0 };
    const chatRow = deferred<Chat | null>();
    const counterpart = deferred<typeof SERVER_COUNTERPART>();
    m.findById.mockReturnValue(chatRow.promise);
    m.getCounterpart.mockReturnValue(counterpart.promise);

    const { result } = renderHook(() => useChatInit('c1', 'me'));

    // First frame: header and status from the seed, before any request has returned.
    expect(result.current.status).toBe('loaded');
    expect(result.current.counterpart.displayName).toBe('Dana');
    expect(result.current.initiallyUnread).toBe(false);
    // Every open request is already in flight.
    expect(m.startThreadSub).toHaveBeenCalledWith('c1', expect.anything(), expect.anything(), expect.any(Function));
    expect(m.findById).toHaveBeenCalledWith('c1');
    expect(m.getCounterpart).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'c1' }), 'me');

    await act(async () => {
      counterpart.resolve(SERVER_COUNTERPART);
      chatRow.resolve(CHAT);
    });
    expect(result.current.counterpart.displayName).toBe('Dana R.');
    // The seeded path does not ask for the counterpart a second time.
    expect(m.getCounterpart).toHaveBeenCalledTimes(1);
  });

  it('starts the messages without waiting for the chat row when the chat is not in the inbox', async () => {
    const chatRow = deferred<Chat | null>();
    m.findById.mockReturnValue(chatRow.promise);
    m.getCounterpart.mockResolvedValue(SERVER_COUNTERPART);

    const { result } = renderHook(() => useChatInit('c1', 'me'));

    expect(result.current.status).toBe('loading');
    expect(result.current.initiallyUnread).toBe(true);
    expect(m.startThreadSub).toHaveBeenCalledTimes(1);
    // Only the counterpart needs the chat row (it names the other member).
    expect(m.getCounterpart).not.toHaveBeenCalled();

    await act(async () => chatRow.resolve(CHAT));
    await waitFor(() => expect(result.current.counterpart.displayName).toBe('Dana R.'));
    expect(result.current.status).toBe('loaded');
    expect(result.current.chat).toEqual(CHAT);
  });

  it('reports a chat that does not exist and closes its subscription', async () => {
    m.findById.mockResolvedValue(null);

    const { result } = renderHook(() => useChatInit('c1', 'me'));

    await waitFor(() => expect(result.current.status).toBe('not_found'));
    expect(m.stopThreadSub).toHaveBeenCalledWith('c1');
    expect(m.getCounterpart).not.toHaveBeenCalled();
  });

  it('contains a failed open request and keeps the seeded screen', async () => {
    m.snapshot = { chats: [INBOX_ROW], unreadTotal: 0 };
    const error = new Error('boom');
    m.findById.mockRejectedValue(error);
    m.getCounterpart.mockResolvedValue(SERVER_COUNTERPART);

    const { result } = renderHook(() => useChatInit('c1', 'me'));

    await waitFor(() => expect(m.report).toHaveBeenCalledWith(error, 'manual', ['chat', 'open']));
    expect(result.current.status).toBe('loaded');
  });

  it('stops the thread subscription on unmount', () => {
    m.findById.mockReturnValue(new Promise(() => undefined));
    const { unmount } = renderHook(() => useChatInit('c1', 'me'));
    unmount();
    expect(m.stopThreadSub).toHaveBeenCalledWith('c1');
  });
});
