// Ride seat booking use cases (docs/spec/05_giving_worlds.md §5.3 step 3, D73; gap G47).
// Authorization and state rules live in the server RPCs; these guard inputs and delegate.
import { isValidRideBookingSeats, RideError, type RideBooking } from '@kc/domain';
import type { IRideBookingRepository } from '../ports/IRideBookingRepository';

export class BookRideSeatUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  /** Rejects a seat count outside 1..8 before reaching the server. */
  execute(listingId: string, seats = 1): Promise<string> {
    if (!isValidRideBookingSeats(seats)) {
      return Promise.reject(new RideError('seats_required', 'seats must be a whole number from 1 to 8'));
    }
    return this.repo.bookSeat(listingId, seats);
  }
}

export class ListRideBookingsUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(listingId: string): Promise<RideBooking[]> {
    return this.repo.listForRide(listingId);
  }
}

export class ApproveRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string): Promise<void> {
    return this.repo.approve(handoffId);
  }
}

export class DeclineRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string): Promise<void> {
    return this.repo.decline(handoffId);
  }
}

export class CancelRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string): Promise<void> {
    return this.repo.cancel(handoffId);
  }
}

export class CompleteRideTripUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string): Promise<void> {
    return this.repo.complete(handoffId);
  }
}

export class CompleteRideListingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(listingId: string): Promise<number> {
    return this.repo.completeRide(listingId);
  }
}
