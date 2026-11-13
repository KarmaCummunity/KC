// @vitest-environment jsdom
// Mapped to spec: FR-ADMIN-034 AC3, FR-HOUSING-001 AC1 / FR-KNOW-* — every build follows the remote
// launch flag, which the super admin switches per environment (#2277). This reverses #1630, under
// which tester (development) builds opened housing and knowledge regardless of the flag.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRemoteFeatureFlags } = vi.hoisted(() => ({ fetchRemoteFeatureFlags: vi.fn() }));
vi.mock('../../services/featureFlagsComposition', () => ({ fetchRemoteFeatureFlags }));
import { useHubTileLaunchEnabled, useMarketplaceWorldLaunchEnabled } from '../useLaunchWorldFlags';
import { useAuthStore } from '../../store/authStore';

const ORIGINAL = process.env['EXPO_PUBLIC_ENVIRONMENT'];
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  useAuthStore.setState({ session: { userId: 'u_member' } as never, isAuthenticated: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  fetchRemoteFeatureFlags.mockResolvedValue({ world_housing_enabled: false, world_knowledge_enabled: false });
});
afterEach(() => {
  cleanup();
  if (ORIGINAL === undefined) delete process.env['EXPO_PUBLIC_ENVIRONMENT'];
  else process.env['EXPO_PUBLIC_ENVIRONMENT'] = ORIGINAL;
});

describe('housing and knowledge follow the remote launch flag in every build (#2277)', () => {
  it('stay portals in a development build while the remote flags are off (was: forced active, #1630)', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    const housing = renderHook(() => useMarketplaceWorldLaunchEnabled('housing'), { wrapper });
    const knowledgeTile = renderHook(() => useHubTileLaunchEnabled('knowledge'), { wrapper });
    await waitFor(() => expect(fetchRemoteFeatureFlags).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(housing.result.current).toBe(false);
    expect(knowledgeTile.result.current).toBe(false);
  });

  it('become active in a development build once the super admin switches them on', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    fetchRemoteFeatureFlags.mockResolvedValue({ world_housing_enabled: true, world_knowledge_enabled: true });
    const housing = renderHook(() => useMarketplaceWorldLaunchEnabled('housing'), { wrapper });
    const knowledgeTile = renderHook(() => useHubTileLaunchEnabled('knowledge'), { wrapper });
    await waitFor(() => expect(housing.result.current).toBe(true));
    expect(knowledgeTile.result.current).toBe(true);
  });

  it('stay portals in a production build until the remote flag is turned on', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    const housing = renderHook(() => useMarketplaceWorldLaunchEnabled('housing'), { wrapper });
    const knowledgeTile = renderHook(() => useHubTileLaunchEnabled('knowledge'), { wrapper });
    await waitFor(() => expect(fetchRemoteFeatureFlags).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(housing.result.current).toBe(false);
    expect(knowledgeTile.result.current).toBe(false);
  });

  it('stay portals when the environment is not set (fail-safe to production)', async () => {
    delete process.env['EXPO_PUBLIC_ENVIRONMENT'];
    const housing = renderHook(() => useMarketplaceWorldLaunchEnabled('housing'), { wrapper });
    await waitFor(() => expect(fetchRemoteFeatureFlags).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(housing.result.current).toBe(false);
  });
});
