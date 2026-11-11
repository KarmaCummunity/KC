import { useQuery } from '@tanstack/react-query';
import { marketplaceRepository } from '../services/marketplaceComposition';

export function useMarketplaceListingDetail(listingId: string | undefined) {
  return useQuery({
    queryKey: ['marketplace-detail', listingId],
    enabled: Boolean(listingId),
    queryFn: async () => {
      if (!listingId) return null;
      return marketplaceRepository().getListingDetail(listingId);
    },
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
