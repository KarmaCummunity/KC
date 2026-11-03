// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { state, subscribe } = vi.hoisted(() => ({ state: { userId: null as string | null }, subscribe: vi.fn() }));
vi.hoisted(() => { (globalThis as { __DEV__?: boolean }).__DEV__ = false; });
vi.mock('../../store/authStore', () => ({ useAuthStore: (selector: (s: { session: { userId: string } | null }) => unknown) => selector({ session: state.userId ? { userId: state.userId } : null }) }));
vi.mock('../../services/userRealtimeComposition', () => ({ getUserRealtime: () => ({ subscribeToSelf: subscribe }) }));
import { useMeRealtime } from '../useMeRealtime';
let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) { const [instance] = useState(() => new QueryClient()); client = instance; return <QueryClientProvider client={instance}>{children}</QueryClientProvider>; }
describe('useMeRealtime', () => {
  beforeEach(() => { vi.clearAllMocks(); state.userId = null; subscribe.mockImplementation(() => vi.fn()); });
  it('skips signed-out users and subscribes, patches cache, invalidates, and cleans up', async () => {
    const { rerender, unmount } = renderHook(() => useMeRealtime(), { wrapper: Wrapper });
    expect(subscribe).not.toHaveBeenCalled();
    state.userId = 'u1';
    rerender();
    const callback = subscribe.mock.calls[0]?.[1];
    const cleanup = subscribe.mock.results[0]?.value;
    expect(subscribe).toHaveBeenCalledWith('u1', expect.any(Function), expect.any(Function));
    expect(cleanup).toBeTypeOf('function');
    client.setQueryData(['user-profile', 'u1'], { id: 'u1', karmaPoints: 10 });
    callback?.({ id: 'u1', karmaPoints: null, displayName: 'Updated' });
    await waitFor(() => expect(client.getQueryState(['user-profile', 'u1'])?.isInvalidated).toBe(true));
    expect(client.getQueryData(['user-profile', 'u1'])).toEqual({ id: 'u1', karmaPoints: 10, displayName: 'Updated' });
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(callback).toBeTypeOf('function');
  });
  it('replaces subscription when user changes', () => {
    const { rerender } = renderHook(() => useMeRealtime(), { wrapper: Wrapper });
    state.userId = 'u1'; rerender();
    const firstCleanup = subscribe.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    state.userId = 'u2'; rerender();
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(subscribe.mock.calls.map((call) => call[0])).toEqual(['u1', 'u2']);
  });
});
