// Composition root for old ride links (docs/spec/05_giving_worlds.md §5.3, D70; G44).
import { FindListingForLegacyRideUseCase, type IRideLegacyLinkRepository } from '@kc/application';
import { SupabaseRideLegacyLinkRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRideLegacyLinkRepository | null = null;

function repository(): IRideLegacyLinkRepository {
  repo ??= new SupabaseRideLegacyLinkRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const findListingForLegacyRide = (rideId: string | null | undefined) =>
  new FindListingForLegacyRideUseCase(repository()).execute(rideId);
