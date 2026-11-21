// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { getMyChats, getUnreadTotal } = vi.hoisted(() => ({
  getMyChats: vi.fn(),
  getUnreadTotal: vi.fn(),
}));
vi.mock('../../lib/container', () => ({ container: { chatRepo: { getMyChats, getUnreadTotal } } }));

import { useChatInboxQuery } from '../useChatInboxQuery';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});
// Auto-cleanup is off (`globals: false`): unmount, or a hook left mounted re-renders on the next client.
afterEach(() => {
  cleanup();
  client.clear();
});

describe('useChatInboxQuery', () => {
  it('loads both repository values for a signed-in user', async () => {
    const chats = [{ chatId: 'c1' }];
    getMyChats.mockResolvedValue(chats);
    getUnreadTotal.mockResolvedValue(3);
    const { result } = renderHook(() => useChatInboxQuery('u1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ chats, unreadTotal: 3 }));
    expect(getMyChats).toHaveBeenCalledWith('u1');
    expect(getUnreadTotal).toHaveBeenCalledWith('u1');
  });

  it('does not fetch without a user and uses a user-scoped key', () => {
    const { result, rerender } = renderHook(({ userId }) => useChatInboxQuery(userId), {
      wrapper,
      initialProps: { userId: null as string | null | undefined },
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getMyChats).not.toHaveBeenCalled();
    rerender({ userId: 'u2' });
    expect(client.getQueryCache().find({ queryKey: ['chat-inbox', 'u2'] })).toBeDefined();
  });

  it('exposes repository failures as query errors', async () => {
    getMyChats.mockRejectedValue(new Error('offline'));
    getUnreadTotal.mockResolvedValue(0);
    const { result } = renderHook(() => useChatInboxQuery('u1'), { wrapper });
    await waitFor(() => expect(result.current.error).toEqual(new Error('offline')));
  });
});

// #2571 — the inbox under an open conversation must not re-read on every realtime invalidation.
describe('useChatInboxQuery while not on screen', () => {
  it('only marks the inbox stale while unsubscribed, then refetches once when subscribed again', async () => {
    getMyChats.mockResolvedValue([]);
    getUnreadTotal.mockResolvedValue(0);
    const { rerender } = renderHook(({ subscribed }) => useChatInboxQuery('u1', { subscribed }), {
      wrapper,
      initialProps: { subscribed: true },
    });
    await waitFor(() => expect(getMyChats).toHaveBeenCalledTimes(1));

    rerender({ subscribed: false });
    // Three events (messages, read markers) arrive while a conversation covers the inbox.
    for (let i = 0; i < 3; i += 1) await client.invalidateQueries({ queryKey: ['chat-inbox', 'u1'] });
    expect(getMyChats).toHaveBeenCalledTimes(1);

    rerender({ subscribed: true });
    await waitFor(() => expect(getMyChats).toHaveBeenCalledTimes(2));
  });

  it('does not refetch on return when nothing changed meanwhile', async () => {
    getMyChats.mockResolvedValue([]);
    getUnreadTotal.mockResolvedValue(0);
    client.setDefaultOptions({ queries: { retry: false, staleTime: 60_000 } });
    const { rerender } = renderHook(({ subscribed }) => useChatInboxQuery('u1', { subscribed }), {
      wrapper,
      initialProps: { subscribed: true },
    });
    await waitFor(() => expect(getMyChats).toHaveBeenCalledTimes(1));
    rerender({ subscribed: false });
    rerender({ subscribed: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getMyChats).toHaveBeenCalledTimes(1);
  });
});
