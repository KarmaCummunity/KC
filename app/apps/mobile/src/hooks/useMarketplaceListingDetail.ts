import { useQuery, type QueryClient } from '@tanstack/react-query';
import { marketplaceRepository } from '../services/marketplaceComposition';

/** How long a prefetched listing detail counts as fresh, so the screen reuses it on mount. */
const LISTING_DETAIL_PREFETCH_STALE_MS = 30_000;

/** Query key of one listing's detail; shared by the screen hook and the tap-time prefetch. */
const listingDetailQueryKey = (listingId: string | undefined) => ['marketplace-detail', listingId] as const;

export function useMarketplaceListingDetail(listingId: string | undefined) {
  return useQuery({
    queryKey: listingDetailQueryKey(listingId),
    enabled: Boolean(listingId),
    queryFn: async () => {
      if (!listingId) return null;
      return marketplaceRepository().getListingDetail(listingId);
    },
  });
}

/**
 * Starts loading a listing's detail before its screen mounts (called when a card is pressed
 * down). The detail screen blocks on this read, so the head start of the press and the
 * navigation transition comes straight off its loading time. A failed prefetch is silent:
 * the screen's own query retries and reports the error.
 */
export function prefetchMarketplaceListingDetail(queryClient: QueryClient, listingId: string): void {
  void queryClient.prefetchQuery({
    queryKey: listingDetailQueryKey(listingId),
    queryFn: () => marketplaceRepository().getListingDetail(listingId),
    staleTime: LISTING_DETAIL_PREFETCH_STALE_MS,
  });
}

export function useSimilarListings(listingId: string | undefined) {
  return useQuery({
    queryKey: ['marketplace-similar', listingId],
    enabled: Boolean(listingId),
    staleTime: 60_000,
    queryFn: () => (listingId ? marketplaceRepository().similarListings(listingId, 8) : []),
  });
}
