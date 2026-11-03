// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
afterEach(() => client.clear());

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
