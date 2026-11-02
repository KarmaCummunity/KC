// Composition root for recurring rides (docs/spec/05_giving_worlds.md §5.3 step 1, FR-RIDE-046).
import {
  CreateRideSeriesUseCase,
  ListMyRideSeriesUseCase,
  SetRideSeriesStatusUseCase,
  UpdateRideSeriesScheduleUseCase,
  type IRideSeriesRepository,
} from '@kc/application';
import { SupabaseRideSeriesRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRideSeriesRepository | null = null;

function repository(): IRideSeriesRepository {
  repo ??= new SupabaseRideSeriesRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const rideSeriesUseCases = {
  create: () => new CreateRideSeriesUseCase(repository()),
  listMine: () => new ListMyRideSeriesUseCase(repository()),
  setStatus: () => new SetRideSeriesStatusUseCase(repository()),
  updateSchedule: () => new UpdateRideSeriesScheduleUseCase(repository()),
};

export const MY_RIDE_SERIES_QUERY_KEY = ['ride-series'] as const;
