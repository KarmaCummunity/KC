// Composition root for a ride's private house numbers (FR-RIDE-003 AC9).
import {
  GetRideHouseNumbersUseCase,
  SaveRideHouseNumbersUseCase,
  type IRideHouseNumberRepository,
} from '@kc/application';
import { SupabaseRideHouseNumberRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRideHouseNumberRepository | null = null;

function repository(): IRideHouseNumberRepository {
  repo ??= new SupabaseRideHouseNumberRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const rideHouseNumberUseCases = {
  save: () => new SaveRideHouseNumbersUseCase(repository()),
  get: () => new GetRideHouseNumbersUseCase(repository()),
};

export const rideHouseNumbersQueryKey = (listingId: string) => ['ride-house-numbers', listingId] as const;
