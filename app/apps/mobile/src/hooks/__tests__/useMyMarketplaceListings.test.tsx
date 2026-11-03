// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { repo, invalidate } = vi.hoisted(() => ({ repo: { listMyListingsPage: vi.fn(), listProfileListings: vi.fn() }, invalidate: vi.fn() }));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => repo }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: invalidate }) };
});
import { useInvalidateMyListings, useMyMarketplaceListings, useProfileMarketplaceListings } from '../useMyMarketplaceListings';
function Wrapper({ children }: PropsWithChildren) { const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } })); return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
describe('useMyMarketplaceListings', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses default and custom page sizes with keyset cursors', async () => {
    repo.listMyListingsPage.mockResolvedValueOnce({ rows: ['one'], nextCursor: { id: 'one' } }).mockResolvedValueOnce({ rows: [], nextCursor: null });
    const { result } = renderHook(() => useMyMarketplaceListings(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(repo.listMyListingsPage).toHaveBeenCalledWith(30, null);
    await result.current.fetchNextPage();
    expect(repo.listMyListingsPage).toHaveBeenLastCalledWith(30, { id: 'one' });
    repo.listMyListingsPage.mockResolvedValueOnce({ rows: [], nextCursor: null });
    const custom = renderHook(() => useMyMarketplaceListings(7), { wrapper: Wrapper });
    await waitFor(() => expect(custom.result.current.isSuccess).toBe(true));
    expect(repo.listMyListingsPage).toHaveBeenCalledWith(7, null);
  });
  it('invalidates the exact family key', async () => {
    const { result } = renderHook(() => useInvalidateMyListings());
    await act(async () => { await result.current(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['marketplace', 'my-listings'] });
  });
  it('disables absent profiles, loads 24 for an owner, and reports errors', async () => {
    const { result, rerender } = renderHook(({ owner }) => useProfileMarketplaceListings(owner), { initialProps: { owner: undefined as string | undefined }, wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(repo.listProfileListings).not.toHaveBeenCalled();
    repo.listProfileListings.mockResolvedValueOnce(['one']);
    rerender({ owner: 'u1' });
    await waitFor(() => expect(result.current.data).toEqual(['one']));
    expect(repo.listProfileListings).toHaveBeenCalledWith('u1', 24);
    repo.listProfileListings.mockRejectedValueOnce(new Error('offline'));
    rerender({ owner: 'u2' });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
