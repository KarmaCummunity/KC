// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { fetchFlags } = vi.hoisted(() => ({ fetchFlags: vi.fn() }));
vi.mock('../../services/featureFlagsComposition', () => ({ fetchRemoteFeatureFlags: fetchFlags }));

import { useFeatureFlag } from '../useFeatureFlag';
import { useAuthStore } from '../../store/authStore';

const withQuery = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => {
  useAuthStore.setState({ session: { userId: 'u_member' } as never, isAuthenticated: true });
});

describe('useFeatureFlag', () => {
  it('returns the compiled default while remote flags are loading, then uses remote data', async () => {
    fetchFlags.mockResolvedValue({});
    fetchFlags.mockResolvedValue({ pro_paywall: true });
    const { result } = renderHook(() => useFeatureFlag('pro_paywall'), { wrapper: withQuery });
    expect(typeof result.current).toBe('boolean');
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchFlags).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default when remote loading fails', async () => {
    fetchFlags.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFeatureFlag('pro_paywall'), { wrapper: withQuery });
    await waitFor(() => expect(fetchFlags).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
