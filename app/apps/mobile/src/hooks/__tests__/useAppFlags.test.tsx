// @vitest-environment jsdom
// Regression for #2148: since the D-228 baseline `app_flags` is readable by signed-in members only,
// so the read the welcome screen made before sign-in failed, was cached as "no flags" for five
// minutes, and rides (a launch world) showed as a portal right after login.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../store/authStore';

const { fetchRemoteFeatureFlags } = vi.hoisted(() => ({ fetchRemoteFeatureFlags: vi.fn() }));
vi.mock('../../services/featureFlagsComposition', () => ({ fetchRemoteFeatureFlags }));

import { useAppFlags } from '../useAppFlags';
import { useLaunchWorldEnabled } from '../useLaunchWorldFlags';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const signIn = (userId: string) =>
  act(() => useAuthStore.setState({ session: { userId } as never, isAuthenticated: true }));
const signOut = () => act(() => useAuthStore.setState({ session: null, isAuthenticated: false }));

beforeEach(() => {
  // The query client is shared across sign-in and sign-out, as in the app.
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  useAuthStore.setState({ session: null, isAuthenticated: false });
  // What RLS does: a member reads the flags, `anon` is denied.
  fetchRemoteFeatureFlags.mockImplementation(async () => {
    if (!useAuthStore.getState().session) throw new Error('permission denied for table app_flags');
    return { world_rides_enabled: true };
  });
});
afterEach(cleanup);

describe('useAppFlags', () => {
  it('does not read the flags while signed out, where the read can only be denied', () => {
    const { result } = renderHook(() => useAppFlags(), { wrapper });
    expect(result.current).toBeUndefined();
    expect(fetchRemoteFeatureFlags).not.toHaveBeenCalled();
  });

  it('loads the flags when a member signs in after the welcome screen was open', async () => {
    const rides = renderHook(() => useLaunchWorldEnabled('world_rides_enabled'), { wrapper });
    expect(rides.result.current).toBe(false); // compiled default before sign-in

    signIn('u_member');

    await waitFor(() => expect(rides.result.current).toBe(true));
    expect(fetchRemoteFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('reads once per member and drops the flags on sign-out', async () => {
    signIn('u_member');
    const { result } = renderHook(() => useAppFlags(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ world_rides_enabled: true }));

    signOut();
    await waitFor(() => expect(result.current).toBeUndefined());

    fetchRemoteFeatureFlags.mockResolvedValue({ world_rides_enabled: false });
    signIn('u_other');
    await waitFor(() => expect(result.current).toEqual({ world_rides_enabled: false }));
    expect(fetchRemoteFeatureFlags).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read as flags: the defaults apply and the next mount reads again', async () => {
    signIn('u_member');
    fetchRemoteFeatureFlags.mockRejectedValueOnce(new Error('offline'));
    const first = renderHook(() => useAppFlags(), { wrapper });
    await waitFor(() => expect(fetchRemoteFeatureFlags).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBeUndefined();
    first.unmount();

    const second = renderHook(() => useAppFlags(), { wrapper });
    await waitFor(() => expect(second.result.current).toEqual({ world_rides_enabled: true }));
    expect(fetchRemoteFeatureFlags).toHaveBeenCalledTimes(2);
  });
});
