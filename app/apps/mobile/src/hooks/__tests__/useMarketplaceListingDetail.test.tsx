// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { repo } = vi.hoisted(() => ({ repo: { getListingDetail: vi.fn(), similarListings: vi.fn() } }));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => repo }));
import { useMarketplaceListingDetail, useSimilarListings } from '../useMarketplaceListingDetail';
function Wrapper({ children }: PropsWithChildren) { const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } })); return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
describe('useMarketplaceListingDetail', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not fetch without an id and loads the detail once there is one', async () => {
    const detail = { listingId: 'l1' };
    const { result, rerender } = renderHook(({ id }) => useMarketplaceListingDetail(id), { initialProps: { id: undefined as string | undefined }, wrapper: Wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(repo.getListingDetail).not.toHaveBeenCalled();
    repo.getListingDetail.mockResolvedValue(detail);
    rerender({ id: 'l1' });
    await waitFor(() => expect(result.current.data).toEqual(detail));
    expect(repo.getListingDetail).toHaveBeenCalledWith('l1');
  });
  it('answers null for a missing detail and exposes repository failures', async () => {
    repo.getListingDetail.mockResolvedValueOnce(null);
    const { result, rerender } = renderHook(({ id }) => useMarketplaceListingDetail(id), { initialProps: { id: 'missing' as string | undefined }, wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    repo.getListingDetail.mockRejectedValueOnce(new Error('offline'));
    rerender({ id: 'broken' });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
  it('loads eight similar listings only when an id exists', async () => {
    repo.similarListings.mockResolvedValue(['l2']);
    const { result } = renderHook(() => useSimilarListings(undefined), { wrapper: Wrapper });
    expect(repo.similarListings).not.toHaveBeenCalled();
    const active = renderHook(() => useSimilarListings('l1'), { wrapper: Wrapper });
    await waitFor(() => expect(active.result.current.data).toEqual(['l2']));
    expect(repo.similarListings).toHaveBeenCalledWith('l1', 8);
    expect(result.current.fetchStatus).toBe('idle');
  });
});
