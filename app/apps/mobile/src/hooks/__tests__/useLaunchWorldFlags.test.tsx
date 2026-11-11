// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRemoteFeatureFlags } = vi.hoisted(() => ({ fetchRemoteFeatureFlags: vi.fn() }));
vi.mock('../../services/featureFlagsComposition', () => ({ fetchRemoteFeatureFlags }));
import { useHubTileLaunchEnabled, useLaunchWorldEnabled, useMarketplaceWorldLaunchEnabled, useRemoteAppFlags } from '../useLaunchWorldFlags';
import { useAuthStore } from '../../store/authStore';
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  useAuthStore.setState({ session: { userId: 'u_member' } as never, isAuthenticated: true });
});
afterEach(cleanup);

describe('launch world flag hooks', () => {
  it('returns remote flags and resolves global, marketplace, and hub flags', async () => {
    fetchRemoteFeatureFlags.mockResolvedValue({ world_items_enabled: true, world_rides_enabled: true, world_money_enabled: true });
    const flags = renderHook(() => useRemoteAppFlags(), { wrapper });
    const global = renderHook(() => useLaunchWorldEnabled('world_items_enabled'), { wrapper });
    const market = renderHook(() => useMarketplaceWorldLaunchEnabled('rides'), { wrapper });
    const tile = renderHook(() => useHubTileLaunchEnabled('money'), { wrapper });
    await waitFor(() => expect(flags.result.current).toBeDefined());
    await waitFor(() => expect(global.result.current).toBe(true));
    expect(market.result.current).toBe(true);
    expect(tile.result.current).toBe(true);
    expect(fetchRemoteFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('uses domain fallbacks while remote flags are unavailable or omit a requested key', async () => {
    fetchRemoteFeatureFlags.mockResolvedValue({});
    const pending = renderHook(() => useLaunchWorldEnabled('world_rides_enabled'), { wrapper });
    expect(pending.result.current).toBe(false);
    await waitFor(() => expect(pending.result.current).toBe(false));
    const unknownMarket = renderHook(() => useMarketplaceWorldLaunchEnabled('unknown'), { wrapper });
    const unknownTile = renderHook(() => useHubTileLaunchEnabled('unknown'), { wrapper });
    await waitFor(() => expect(unknownMarket.result.current).toBe(true));
    expect(unknownTile.result.current).toBe(true);
  });
});
