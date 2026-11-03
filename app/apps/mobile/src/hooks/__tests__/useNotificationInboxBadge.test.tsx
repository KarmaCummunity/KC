// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { unreadCount, channel, removeChannel } = vi.hoisted(() => ({ unreadCount: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock('../../lib/container', () => ({
  container: { notificationInbox: { unreadCount } },
  supabase: { channel, removeChannel },
}));
import { useNotificationInboxBadge } from '../useNotificationInboxBadge';
let client: QueryClient;
let handler: ((payload: { payload: unknown }) => void) | undefined;
let channelInstance: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks(); handler = undefined;
  channelInstance = { on: vi.fn((_type: string, _filter: unknown, callback: (payload: { payload: unknown }) => void) => { handler = callback; return channelInstance; }), subscribe: vi.fn(() => channelInstance) };
  channel.mockReturnValue(channelInstance); unreadCount.mockResolvedValue(4); removeChannel.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('useNotificationInboxBadge', () => {
  it('returns zero without a user and does not query or subscribe', () => {
    const { result } = renderHook(() => useNotificationInboxBadge(null), { wrapper });
    expect(result.current).toBe(0);
    expect(unreadCount).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
  });

  it('loads count, listens on the private user topic, applies numeric broadcasts, and cleans up', async () => {
    const hook = renderHook(() => useNotificationInboxBadge('u1'), { wrapper });
    await waitFor(() => expect(hook.result.current).toBe(4));
    expect(channel).toHaveBeenCalledWith('user:u1:notifications', { config: { private: true } });
    expect(channelInstance.on).toHaveBeenCalledWith('broadcast', { event: 'badge' }, expect.any(Function));
    act(() => { handler?.({ payload: { unread_count: 11 } }); });
    await waitFor(() => expect(hook.result.current).toBe(11));
    expect(client.getQueryData(['notification-inbox', 'u1'])).toBeUndefined();
    hook.unmount();
    expect(removeChannel).toHaveBeenCalledWith(channelInstance);
  });

  it('invalidates both inbox queries for malformed broadcasts and exposes query errors as zero', async () => {
    const hook = renderHook(() => useNotificationInboxBadge('u2'), { wrapper });
    await waitFor(() => expect(hook.result.current).toBe(4));
    act(() => { handler?.({ payload: { unread_count: 'bad' } }); });
    await waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(2));
    hook.unmount();
    unreadCount.mockRejectedValue(new Error('offline'));
    const failed = renderHook(() => useNotificationInboxBadge('u3'), { wrapper });
    await waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(3));
    expect(failed.result.current).toBe(0);
  });
});
