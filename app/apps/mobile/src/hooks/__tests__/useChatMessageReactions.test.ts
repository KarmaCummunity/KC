// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useChatMessageReactions } from '../useChatMessageReactions';
import { hapticSuccess } from '../../lib/haptics';

const listMock = vi.fn();
const setReactionMock = vi.fn();

vi.mock('../../lib/container', () => ({
  container: {
    chatV2Repo: {
      listMessageReactions: (...args: unknown[]) => listMock(...args),
      setMessageReaction: (...args: unknown[]) => setReactionMock(...args),
    },
  },
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: { session: { userId: string } | null }) => unknown) =>
    selector({ session: { userId: 'viewer-1' } }),
}));

vi.mock('../../lib/haptics', () => ({
  hapticSuccess: vi.fn(),
}));

describe('useChatMessageReactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when messageIds is empty', () => {
    const { result } = renderHook(() => useChatMessageReactions('chat-1', []));
    expect(listMock).not.toHaveBeenCalled();
    expect(result.current.byMessage).toEqual({});
    expect(result.current.mine).toEqual({});
  });

  it('loads reactions and distinguishes own reactions', async () => {
    listMock.mockResolvedValue([
      { messageId: 'm1', userId: 'viewer-1', reactionType: 'love' },
      { messageId: 'm1', userId: 'other-user', reactionType: 'love' },
      { messageId: 'm2', userId: 'other-user', reactionType: 'like' },
    ]);

    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1', 'm2']));

    await waitFor(() => {
      expect(result.current.byMessage.m1).toEqual({ love: 2 });
    });

    expect(result.current.byMessage.m2).toEqual({ like: 1 });
    expect(result.current.mine.m1).toBe('love');
    expect(result.current.mine.m2).toBeNull();
  });

  it('handles a failed reaction read without leaving an unhandled rejection', async () => {
    listMock.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));

    await waitFor(() => expect(listMock).toHaveBeenCalledWith(['m1']));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.byMessage).toEqual({});
    expect(result.current.mine).toEqual({});
  });

  it('does not re-fetch when passed a new array reference with identical IDs', async () => {
    listMock.mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ ids }) => useChatMessageReactions('chat-1', ids),
      { initialProps: { ids: ['m1', 'm2'] } },
    );

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    rerender({ ids: ['m1', 'm2'] });
    expect(listMock).toHaveBeenCalledTimes(1);

    rerender({ ids: ['m1', 'm2', 'm3'] });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it('toggles reaction on and off correctly', async () => {
    listMock.mockResolvedValue([
      { messageId: 'm1', userId: 'viewer-1', reactionType: 'love' },
    ]);
    setReactionMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));
    await waitFor(() => expect(result.current.mine.m1).toBe('love'));

    // Toggle same reaction off
    await act(async () => {
      await result.current.toggle('m1', 'love');
    });
    expect(setReactionMock).toHaveBeenCalledWith('m1', null);
    expect(result.current.mine.m1).toBeNull();
    expect(hapticSuccess).not.toHaveBeenCalled();

    // Toggle new reaction on
    await act(async () => {
      await result.current.toggle('m1', 'like');
    });
    expect(setReactionMock).toHaveBeenCalledWith('m1', 'like');
    expect(result.current.mine.m1).toBe('like');
    expect(hapticSuccess).toHaveBeenCalledTimes(1);
  });

  it('gives no haptic when the reaction request fails', async () => {
    listMock.mockResolvedValue([]);
    setReactionMock.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useChatMessageReactions('chat-1', ['m1']));
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    await act(async () => {
      await expect(result.current.toggle('m1', 'like')).rejects.toThrow('offline');
    });
    expect(hapticSuccess).not.toHaveBeenCalled();
    expect(result.current.mine.m1).toBeNull();
  });
});
