// Composition root for saved routes (docs/spec/05_giving_worlds.md §5.3 step 4, D74; G48).
import {
  ListMyRideRoutesUseCase,
  RemoveRideRouteUseCase,
  SaveRideRouteUseCase,
  type IRideSavedRoutesRepository,
} from '@kc/application';
import { SupabaseRideSavedRoutesRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRideSavedRoutesRepository | null = null;

function repository(): IRideSavedRoutesRepository {
  repo ??= new SupabaseRideSavedRoutesRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const rideSavedRoutesUseCases = {
  listMine: () => new ListMyRideRoutesUseCase(repository()),
  save: () => new SaveRideRouteUseCase(repository()),
  remove: () => new RemoveRideRouteUseCase(repository()),
};

export const MY_RIDE_ROUTES_QUERY_KEY = ['ride-saved-routes'] as const;
