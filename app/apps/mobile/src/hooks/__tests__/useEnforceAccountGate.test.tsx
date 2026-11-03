// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { checkGate, setForbidden, replace, fullSignOut } = vi.hoisted(() => ({
  checkGate: vi.fn(), setForbidden: vi.fn(), replace: vi.fn(), fullSignOut: vi.fn(),
}));
vi.mock('../../lib/container', () => ({ container: { checkAccountGate: { execute: checkGate }, deviceRepo: {} } }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@kc/infrastructure-supabase', () => ({ setOnForbiddenCallback: setForbidden }));
vi.mock('../../services/performFullSignOut', () => ({ performFullSignOut: fullSignOut }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (selector: (s: { signOut: () => void }) => unknown) => selector({ signOut: vi.fn() }) }));

import { useEnforceAccountGate } from '../useEnforceAccountGate';
import { useSuspensionStore } from '../../store/suspensionStore';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  client = new QueryClient();
  fullSignOut.mockResolvedValue(undefined);
  checkGate.mockResolvedValue({ allowed: true });
  useSuspensionStore.getState().setSuspension(null);
});
afterEach(() => { vi.useRealTimers(); client.clear(); });

describe('useEnforceAccountGate', () => {
  it('clears suspension and forbidden callback without a user', () => {
    useSuspensionStore.getState().setSuspension({ reason: 'hold', until: null });
    const { unmount } = renderHook(() => useEnforceAccountGate(null), { wrapper });
    expect(useSuspensionStore.getState().suspension).toBeNull();
    expect(setForbidden).toHaveBeenCalledWith(null);
    expect(checkGate).not.toHaveBeenCalled();
    unmount();
  });

  it('checks immediately and on the interval, then unregisters and clears the timer', async () => {
    const { unmount } = renderHook(() => useEnforceAccountGate('u1'), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(checkGate).toHaveBeenCalledWith({ userId: 'u1' });
    expect(checkGate).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await Promise.resolve(); });
    expect(checkGate).toHaveBeenCalledTimes(2);
    unmount();
    expect(setForbidden).toHaveBeenLastCalledWith(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(checkGate).toHaveBeenCalledTimes(2);
  });

  it('signs out and routes a suspended/reverify decision appropriately', async () => {
    checkGate.mockResolvedValueOnce({ allowed: false, reason: 'suspended_admin', until: 'soon' })
      .mockResolvedValueOnce({ allowed: false, reason: 'pending_verification', until: null });
    const { rerender } = renderHook(({ userId }) => useEnforceAccountGate(userId), { wrapper, initialProps: { userId: 'u1' } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(useSuspensionStore.getState().suspension).toEqual({ reason: 'suspended_admin', until: 'soon' });
    rerender({ userId: 'u2' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(fullSignOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('routes banned accounts and retries after transient errors', async () => {
    checkGate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ allowed: false, reason: 'policy', until: null });
    const { unmount } = renderHook(() => useEnforceAccountGate('u1'), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await Promise.resolve(); await Promise.resolve(); });
    expect(fullSignOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith({ pathname: '/account-blocked', params: { reason: 'policy', until: '' } });
    unmount();
  });
});
