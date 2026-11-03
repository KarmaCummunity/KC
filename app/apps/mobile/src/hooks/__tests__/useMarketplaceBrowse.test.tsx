// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo } = vi.hoisted(() => ({ repo: {
  browsePage: vi.fn(), searchPage: vi.fn(), getListingCards: vi.fn(), recommendForYou: vi.fn(),
} }));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => repo }));

import { flattenPages, useMarketplaceBrowse, useMarketplaceRecommendations, useMarketplaceSearchResults } from '../useMarketplaceBrowse';

function Wrapper({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useMarketplaceBrowse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the default limit and cursor, then uses the next cursor', async () => {
    const row = { listingId: 'l1' };
    repo.browsePage.mockResolvedValueOnce({ rows: [row], nextCursor: { id: 'l1' } }).mockResolvedValueOnce({ rows: [], nextCursor: null });
    const { result } = renderHook(() => useMarketplaceBrowse({ worldSlug: 'food' } as Parameters<typeof useMarketplaceBrowse>[0]), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(repo.browsePage).toHaveBeenLastCalledWith({ worldSlug: 'food', limit: 24, cursor: null });
    await result.current.fetchNextPage();
    expect(repo.browsePage).toHaveBeenLastCalledWith({ worldSlug: 'food', limit: 24, cursor: { id: 'l1' } });
    expect(flattenPages(result.current.data)).toEqual([row]);
    expect(flattenPages(undefined)).toEqual([]);
  });

  it('uses a supplied limit and propagates browse errors', async () => {
    repo.browsePage.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useMarketplaceBrowse({ worldSlug: 'food', limit: 5 } as Parameters<typeof useMarketplaceBrowse>[0]), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(repo.browsePage).toHaveBeenCalledWith({ worldSlug: 'food', limit: 5, cursor: null });
  });

  it('trims and disables short searches, then batches returned rows into cards', async () => {
    const { result, rerender } = renderHook(({ query }) => useMarketplaceSearchResults(query, 'food'), { initialProps: { query: ' x ' }, wrapper: Wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(repo.searchPage).not.toHaveBeenCalled();
    repo.searchPage.mockResolvedValue({ rows: ['l1'], nextCursor: null });
    repo.getListingCards.mockResolvedValue([{ listingId: 'l1' }]);
    rerender({ query: '  bread ' });
    await waitFor(() => expect(result.current.data?.pages[0]?.rows).toEqual([{ listingId: 'l1' }]));
    expect(repo.searchPage).toHaveBeenCalledWith('bread', 'food', 24, null);
    expect(repo.getListingCards).toHaveBeenCalledWith(['l1']);
  });

  it('loads recommendation cards and exposes failures', async () => {
    repo.recommendForYou.mockResolvedValue(['l1']);
    repo.getListingCards.mockResolvedValue([{ listingId: 'l1' }]);
    const { result, rerender } = renderHook(({ limit }) => useMarketplaceRecommendations(limit), { initialProps: { limit: 3 }, wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ listingId: 'l1' }]));
    expect(repo.recommendForYou).toHaveBeenCalledWith(3);
    repo.recommendForYou.mockRejectedValueOnce(new Error('offline'));
    rerender({ limit: 4 });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
