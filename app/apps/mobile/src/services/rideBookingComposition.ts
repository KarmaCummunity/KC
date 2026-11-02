// Composition root for ride seat bookings (docs/spec/05_giving_worlds.md §5.3, D73; G47).
import {
  ApproveRideBookingUseCase,
  BookRideSeatUseCase,
  CancelRideBookingUseCase,
  CompleteRideTripUseCase,
  CompleteRideListingUseCase,
  DeclineRideBookingUseCase,
  ListRideBookingsUseCase,
  type IRideBookingRepository,
} from '@kc/application';
import { SupabaseRideBookingRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRideBookingRepository | null = null;

/** One adapter per app session, created on first use (after auth storage is ready). */
function repository(): IRideBookingRepository {
  repo ??= new SupabaseRideBookingRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const rideBookingUseCases = {
  book: () => new BookRideSeatUseCase(repository()),
  listForRide: () => new ListRideBookingsUseCase(repository()),
  approve: () => new ApproveRideBookingUseCase(repository()),
  decline: () => new DeclineRideBookingUseCase(repository()),
  cancel: () => new CancelRideBookingUseCase(repository()),
  complete: () => new CompleteRideTripUseCase(repository()),
  completeRide: () => new CompleteRideListingUseCase(repository()),
};

/** React Query key of a ride's bookings list (driver view). */
export const rideBookingsQueryKey = (listingId: string) => ['ride-bookings', listingId] as const;
