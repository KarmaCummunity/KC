// Composition root for the ride place catalog (docs/spec/05_giving_worlds.md §5.3, D71; G45).
import { ListRidePlacesUseCase, type IRidePlaceRepository } from '@kc/application';
import { SupabaseRidePlaceRepository } from '@kc/infrastructure-supabase';
import type { RidePlace } from '@kc/domain';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRidePlaceRepository | null = null;

function repository(): IRidePlaceRepository {
  repo ??= new SupabaseRidePlaceRepository(getMarketplaceSupabaseClient());
  return repo;
}

/** Every official city and junction a ride place can be picked from. */
export function listRidePlaces(): Promise<RidePlace[]> {
  return new ListRidePlacesUseCase(repository()).execute();
}

/** React Query key of the place catalog; it changes only with a migration, so cache it long. */
export const RIDE_PLACES_QUERY_KEY = ['ride-places'] as const;
