// @vitest-environment jsdom
// KC#873 / #2568 — reactions of the open conversation, over the real chat store.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { Message } from '@kc/domain';

const m = vi.hoisted(() => ({ list: vi.fn(), setReaction: vi.fn(), report: vi.fn() }));

vi.mock('../../lib/container', () => ({
  container: {
    chatV2Repo: {
      listMessageReactions: (...args: unknown[]) => m.list(...args),
      setMessageReaction: (...args: unknown[]) => m.setReaction(...args),
    },
  },
}));
vi.mock('../../store/authStore', () => {
  const state = { session: { userId: 'viewer-1' } };
  const useAuthStore = (selector: (s: typeof state) => unknown) => selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../../lib/queryPersist', () => ({ queryClient: new QueryClient() }));
vi.mock('../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('../../lib/observability/reportHandledError', () => ({ reportHandledError: m.report }));

import { useChatMessageReactions } from '../useChatMessageReactions';
import { useChatStore } from '../../store/chatStore';
import { hapticSuccess } from '../../lib/haptics';

const incoming = (id: string): Message => ({
  messageId: id,
  chatId: 'chat-1',
  senderId: 'peer',
  kind: 'user',
  body: id,
  systemPayload: null,
  mediaPayload: null,
  status: 'delivered',
  createdAt: '2026-11-21T10:00:00.000Z',
  deliveredAt: '2026-11-21T10:00:00.000Z',
  readAt: null,
});

describe('useChatMessageReactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({ threads: {}, reactions: {} });
  });
  // Auto-cleanup is off (`globals: false`); hooks left mounted would react to the shared store.
  afterEach(() => cleanup());

  it('does nothing when messageIds is empty', () => {
    const { result } = renderHook(() => useChatMessageReactions('chat-1', []));
    expect(m.list).not.toHaveBeenCalled();
    expect(result.current.byMessage).toEqual({});
    expect(result.current.mine).toEqual({});
  });

  it('loads reactions and distinguishes own reactions', async () => {
    m.list.mockResolvedValue([
      { messageId: 'm1', userId: 'viewer-1', reactionType: 'love' },
      { messageId: 'm1', userId: 'other-user', reactionType: 'love' },
      { messageId: 'm2', userId: 'other-user', reactionType: 'like' },
    ]);

    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1', 'm2']));

    await waitFor(() => expect(result.current.byMessage.m1).toEqual({ love: 2 }));
    expect(result.current.byMessage.m2).toEqual({ like: 1 });
    expect(result.current.mine.m1).toBe('love');
    expect(result.current.mine.m2).toBeNull();
  });

  it('handles a failed reaction read without leaving an unhandled rejection', async () => {
    m.list.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));

    await waitFor(() => expect(m.list).toHaveBeenCalledWith(['m1']));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.byMessage).toEqual({});
    expect(result.current.mine).toEqual({});
  });

  it('does not re-fetch for a new array with the same ids, and reads only ids not yet known', async () => {
    m.list.mockResolvedValue([]);
    const { rerender } = renderHook(({ ids }) => useChatMessageReactions('chat-1', ids), {
      initialProps: { ids: ['m1', 'm2'] },
    });
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(1));

    rerender({ ids: ['m1', 'm2'] });
    expect(m.list).toHaveBeenCalledTimes(1);

    // A page-loaded id the store does not know yet is read alone, not with the whole page.
    rerender({ ids: ['m1', 'm2', 'm3'] });
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
    expect(m.list).toHaveBeenLastCalledWith(['m3']);
  });

  it('reads nothing for a message received while the chat is open (AC1)', async () => {
    m.list.mockResolvedValue([]);
    const { rerender } = renderHook(({ ids }) => useChatMessageReactions('chat-1', ids), {
      initialProps: { ids: ['m1'] },
    });
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(1));

    act(() => useChatStore.getState().applyIncomingMessage('chat-1', incoming('m2')));
    rerender({ ids: ['m1', 'm2'] });
    await act(async () => { await Promise.resolve(); });
    expect(m.list).toHaveBeenCalledTimes(1);
  });

  it('shows a peer reaction from the broadcast without a re-read (AC2)', async () => {
    m.list.mockResolvedValue([]);
    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));
    await waitFor(() => expect(result.current.byMessage.m1).toEqual({}));

    act(() => useChatStore.getState().applyReactionChange('chat-1', { messageId: 'm1', userId: 'peer', reactionType: 'laugh' }));
    expect(result.current.byMessage.m1).toEqual({ laugh: 1 });

    act(() => useChatStore.getState().applyReactionChange('chat-1', { messageId: 'm1', userId: 'peer', reactionType: null }));
    expect(result.current.byMessage.m1).toEqual({});
    expect(m.list).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary object of an unchanged message, so only the changed bubble re-renders (AC5)', async () => {
    m.list.mockResolvedValue([{ messageId: 'm2', userId: 'peer', reactionType: 'like' }]);
    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1', 'm2']));
    await waitFor(() => expect(result.current.byMessage.m2).toEqual({ like: 1 }));
    const before = result.current.byMessage.m2;

    act(() => useChatStore.getState().applyReactionChange('chat-1', { messageId: 'm1', userId: 'peer', reactionType: 'sad' }));
    expect(result.current.byMessage.m1).toEqual({ sad: 1 });
    expect(result.current.byMessage.m2).toBe(before);
  });

  it('toggles a reaction on and off, updating counts and selection at once (AC3)', async () => {
    m.list.mockResolvedValue([{ messageId: 'm1', userId: 'viewer-1', reactionType: 'love' }]);
    m.setReaction.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));
    await waitFor(() => expect(result.current.mine.m1).toBe('love'));

    await act(async () => { await result.current.toggle('m1', 'love'); });
    expect(m.setReaction).toHaveBeenCalledWith('m1', null);
    expect(result.current.mine.m1).toBeNull();
    expect(result.current.byMessage.m1).toEqual({});
    expect(hapticSuccess).not.toHaveBeenCalled();

    await act(async () => { await result.current.toggle('m1', 'like'); });
    expect(m.setReaction).toHaveBeenCalledWith('m1', 'like');
    expect(result.current.mine.m1).toBe('like');
    expect(result.current.byMessage.m1).toEqual({ like: 1 });
    expect(hapticSuccess).toHaveBeenCalledTimes(1);
  });

  it('restores the previous reaction and reports a failed request, without haptic or rejection', async () => {
    m.list.mockResolvedValue([{ messageId: 'm1', userId: 'viewer-1', reactionType: 'sad' }]);
    const error = new Error('offline');
    m.setReaction.mockRejectedValue(error);
    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));
    await waitFor(() => expect(result.current.mine.m1).toBe('sad'));

    await act(async () => { await result.current.toggle('m1', 'like'); });
    expect(hapticSuccess).not.toHaveBeenCalled();
    expect(result.current.mine.m1).toBe('sad');
    expect(result.current.byMessage.m1).toEqual({ sad: 1 });
    expect(m.report).toHaveBeenCalledWith(error, 'mutation', ['chat', 'reaction']);
  });
});
