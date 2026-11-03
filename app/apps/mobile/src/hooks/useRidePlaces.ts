// The official ride place catalog (cities + junctions), loaded once per session (D71).
import { useQuery } from '@tanstack/react-query';
import { listRidePlaces, RIDE_PLACES_QUERY_KEY } from '../services/ridePlaceComposition';

export function useRidePlaces() {
  return useQuery({
    queryKey: RIDE_PLACES_QUERY_KEY,
    queryFn: listRidePlaces,
    // The catalog changes only with a migration.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60,
  });
}
