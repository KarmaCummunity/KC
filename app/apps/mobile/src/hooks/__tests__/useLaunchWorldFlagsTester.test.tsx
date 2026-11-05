// @vitest-environment jsdom
// Mapped to spec: FR-HOUSING-001 AC1 / FR-KNOW-* — tester (development) builds open housing and
// knowledge as in-app feeds; a production build keeps the remote launch flag (#1630).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRemoteFeatureFlags } = vi.hoisted(() => ({ fetchRemoteFeatureFlags: vi.fn() }));
vi.mock('../../services/featureFlagsComposition', () => ({ fetchRemoteFeatureFlags }));
import { useHubTileLaunchEnabled, useMarketplaceWorldLaunchEnabled } from '../useLaunchWorldFlags';

const ORIGINAL = process.env['EXPO_PUBLIC_ENVIRONMENT'];
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  fetchRemoteFeatureFlags.mockResolvedValue({ world_housing_enabled: false, world_knowledge_enabled: false });
});
afterEach(() => {
  cleanup();
  if (ORIGINAL === undefined) delete process.env['EXPO_PUBLIC_ENVIRONMENT'];
  else process.env['EXPO_PUBLIC_ENVIRONMENT'] = ORIGINAL;
});

describe('housing and knowledge launch in tester builds (#1630)', () => {
  it('are active in a development build even though the remote flags are off', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    const housing = renderHook(() => useMarketplaceWorldLaunchEnabled('housing'), { wrapper });
    const knowledgeTile = renderHook(() => useHubTileLaunchEnabled('knowledge'), { wrapper });
    expect(housing.result.current).toBe(true);
    await waitFor(() => expect(fetchRemoteFeatureFlags).toHaveBeenCalled());
    expect(housing.result.current).toBe(true);
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
