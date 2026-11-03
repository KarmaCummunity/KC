// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { subscribeTyping, sendTyping, unsubscribe } = vi.hoisted(() => ({
  subscribeTyping: vi.fn(), sendTyping: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('../../lib/container', () => ({
  container: { chatV2Realtime: { subscribeTyping: (...args: unknown[]) => subscribeTyping(...args) } },
}));
import { PEER_TYPING_TIMEOUT_MS, SELF_IDLE_MS, useChatTypingIndicator } from '../useChatTypingIndicator';

let peerCallback: ((event: { typing: boolean }) => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); sendTyping.mockClear(); unsubscribe.mockClear(); subscribeTyping.mockReset();
  peerCallback = undefined;
  subscribeTyping.mockImplementation((_chatId: string, _userId: string, handlers: { onPeerTyping: (event: { typing: boolean }) => void }) => {
    peerCallback = handlers.onPeerTyping;
    return { sendTyping, unsubscribe };
  });
});
afterEach(() => vi.useRealTimers());

describe('useChatTypingIndicator', () => {
  it('skips subscription without identifiers and announces typing until idle', () => {
    const empty = renderHook(() => useChatTypingIndicator('', 'u1'));
    expect(subscribeTyping).not.toHaveBeenCalled();
    empty.unmount();
    const { result } = renderHook(() => useChatTypingIndicator('chat-1', 'u1'));
    expect(subscribeTyping).toHaveBeenCalledWith('chat-1', 'u1', expect.objectContaining({ onPeerTyping: expect.any(Function) }));
    act(() => result.current.notifyComposerChanged());
    act(() => vi.advanceTimersByTime(SELF_IDLE_MS - 1));
    expect(sendTyping).toHaveBeenNthCalledWith(1, true);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(sendTyping).toHaveBeenNthCalledWith(2, false);
  });

  it('restarts peer timeout independently and clears peer typing on stopped event', () => {
    const { result } = renderHook(() => useChatTypingIndicator('chat-1', 'u1'));
    act(() => peerCallback?.({ typing: true }));
    expect(result.current.peerTyping).toBe(true);
    act(() => vi.advanceTimersByTime(PEER_TYPING_TIMEOUT_MS - 1));
    act(() => peerCallback?.({ typing: true }));
    act(() => result.current.notifyComposerChanged());
    act(() => vi.advanceTimersByTime(PEER_TYPING_TIMEOUT_MS - 1));
    expect(result.current.peerTyping).toBe(true);
    act(() => peerCallback?.({ typing: false }));
    expect(result.current.peerTyping).toBe(false);
    act(() => vi.advanceTimersByTime(PEER_TYPING_TIMEOUT_MS));
    expect(result.current.peerTyping).toBe(false);
  });

  it('message sent cancels the self timer; unmount clears both timers and unsubscribes', () => {
    const { result, unmount } = renderHook(() => useChatTypingIndicator('chat-1', 'u1'));
    act(() => {
      result.current.notifyComposerChanged();
      peerCallback?.({ typing: true });
      result.current.notifyMessageSent();
    });
    expect(sendTyping).toHaveBeenNthCalledWith(1, true);
    expect(sendTyping).toHaveBeenNthCalledWith(2, false);
    expect(result.current.peerTyping).toBe(true);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(Math.max(SELF_IDLE_MS, PEER_TYPING_TIMEOUT_MS)));
    expect(sendTyping).toHaveBeenCalledTimes(2);
  });
});
