// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ gate: vi.fn(), replace: vi.fn(), forbidden: vi.fn(), setSuspension: vi.fn(), signOut: vi.fn(), fullSignOut: vi.fn(), clear: vi.fn(), invalidate: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: m.replace }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: m.clear, invalidateQueries: m.invalidate }) }));
vi.mock('../../services/userRealtimeComposition', () => ({ getUserRealtime: () => ({ subscribeToAccount: m.subscribe }) }));
vi.mock('../..//lib/container', () => ({ container: { checkAccountGate: { execute: m.gate }, deviceRepo: {} } }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (sel: (state: { signOut: typeof m.signOut }) => unknown) => sel({ signOut: m.signOut }) }));
vi.mock('../../store/suspensionStore', () => ({ useSuspensionStore: { getState: () => ({ setSuspension: m.setSuspension }) } }));
vi.mock('@kc/infrastructure-supabase', () => ({ setOnForbiddenCallback: m.forbidden }));
vi.mock('../../services/performFullSignOut', () => ({ performFullSignOut: m.fullSignOut }));
import { useEnforceAccountGate } from '../useEnforceAccountGate';
describe('useEnforceAccountGate', () => {
  beforeEach(() => { vi.clearAllMocks(); m.subscribe.mockReturnValue(m.unsubscribe); });
  it('publishes suspension state while keeping the session active', async () => {
    m.gate.mockResolvedValue({ allowed: false, reason: 'suspended_admin', until: 'soon' });
    renderHook(() => useEnforceAccountGate('u1'));
    await waitFor(() => expect(m.setSuspension).toHaveBeenCalledWith({ reason: 'suspended_admin', until: 'soon' }));
    expect(m.replace).not.toHaveBeenCalled();
  });
  it('clears enforcement for a missing user and registers forbidden retry for signed-in user', async () => {
    m.gate.mockResolvedValue({ allowed: true });
    const { rerender } = renderHook(({ id }) => useEnforceAccountGate(id), { initialProps: { id: null as string | null } });
    expect(m.setSuspension).toHaveBeenCalledWith(null);
    rerender({ id: 'u1' });
    await waitFor(() => expect(m.forbidden).toHaveBeenCalledWith(expect.any(Function)));
  });
  it('re-verifies by signing out and routing to sign in', async () => {
    m.gate.mockResolvedValue({ allowed: false, reason: 'pending_verification' }); m.fullSignOut.mockResolvedValue(undefined);
    renderHook(() => useEnforceAccountGate('u1'));
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('/(auth)/sign-in'));
    expect(m.fullSignOut).toHaveBeenCalledWith(expect.objectContaining({ deviceRepo: {}, queryClient: expect.anything(), signOutLocal: m.signOut }));
    expect(m.setSuspension).toHaveBeenCalledWith(null);
  });
  it('signs out a blocked account and preserves reason and until in the route', async () => {
    m.gate.mockResolvedValue({ allowed: false, reason: 'banned', until: '2030-01-01' }); m.fullSignOut.mockResolvedValue(undefined);
    renderHook(() => useEnforceAccountGate('u2'));
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith({ pathname: '/account-blocked', params: { reason: 'banned', until: '2030-01-01' } }));
    expect(m.fullSignOut).toHaveBeenCalledTimes(1);
  });
  it('routes a deleted account to the restore screen once, without signing out (FR-AUTH-016)', async () => {
    vi.useFakeTimers();
    m.gate.mockResolvedValue({ allowed: false, reason: 'pending_deletion', until: '2026-12-03T00:00:00Z' });
    renderHook(() => useEnforceAccountGate('u3'));
    await vi.waitFor(() => expect(m.replace).toHaveBeenCalledWith({ pathname: '/restore-account', params: { until: '2026-12-03T00:00:00Z' } }));
    expect(m.fullSignOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.gate).toHaveBeenCalledTimes(2);
    expect(m.replace).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('retries after gate failures and removes callback on unmount', async () => {
    vi.useFakeTimers(); m.gate.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ allowed: true });
    const { unmount } = renderHook(() => useEnforceAccountGate('u1'));
    await vi.waitFor(() => expect(m.gate).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.gate).toHaveBeenCalledTimes(2); expect(m.setSuspension).toHaveBeenCalledWith(null);
    unmount(); expect(m.forbidden).toHaveBeenLastCalledWith(null); vi.useRealTimers();
  });
  it('re-reads the gate and the profile when the server pushes an account change, and unsubscribes on unmount', async () => {
    m.gate.mockResolvedValue({ allowed: true });
    const { unmount } = renderHook(() => useEnforceAccountGate('u1'));
    await waitFor(() => expect(m.subscribe).toHaveBeenCalledWith('u1', expect.any(Function)));
    await waitFor(() => expect(m.gate).toHaveBeenCalledTimes(1));

    m.gate.mockResolvedValue({ allowed: false, reason: 'banned', until: undefined }); m.fullSignOut.mockResolvedValue(undefined);
    const onAccountChanged = m.subscribe.mock.calls[0]![1] as () => void;
    onAccountChanged();

    await waitFor(() => expect(m.replace).toHaveBeenCalledWith({ pathname: '/account-blocked', params: { reason: 'banned', until: '' } }));
    expect(m.invalidate).toHaveBeenCalledWith({ queryKey: ['user-profile', 'u1'] });
    unmount();
    expect(m.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('does not subscribe without a signed-in user', () => {
    renderHook(() => useEnforceAccountGate(null));
    expect(m.subscribe).not.toHaveBeenCalled();
  });
});
