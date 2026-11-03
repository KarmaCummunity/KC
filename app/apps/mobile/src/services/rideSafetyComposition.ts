// Composition root for ride safety (docs/spec/05_giving_worlds.md §5.3 step 6, D70; G44).
import { RaiseRideEmergencyUseCase, type IRideSafetyRepository } from '@kc/application';
import { SupabaseRideSafetyRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRideSafetyRepository | null = null;

function repository(): IRideSafetyRepository {
  repo ??= new SupabaseRideSafetyRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const raiseRideEmergency = (listingId: string, note?: string | null) =>
  new RaiseRideEmergencyUseCase(repository()).execute(listingId, note);
