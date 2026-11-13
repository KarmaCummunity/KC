// Ride seat booking use cases (docs/spec/05_giving_worlds.md §5.3 step 3, D73; gap G47).
// Authorization and state rules live in the server RPCs; these guard inputs and delegate.
import {
  canApproveRideBooking,
  canPerformBookingAction,
  isRideTripCompletable,
  isValidRideBookingSeats,
  rideReinstateBlocker,
  RideError,
  type RideBooking,
  type RideBookingRideContext,
  type RideBookingStatus,
} from '@kc/domain';
import type { IRideBookingRepository } from '../ports/IRideBookingRepository';

export interface BookRideSeatContext {
  readonly capacity?: number;
  readonly freeSeats?: number;
  readonly departsAt?: string | null;
}

export interface BookRideSeatOptions {
  readonly requestedMeetingPoint?: Record<string, unknown> | null;
}

export class BookRideSeatUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  /** Rejects a seat count outside 1..8 or exceeding availability before reaching the server. */
  execute(
    listingId: string,
    seats = 1,
    context?: BookRideSeatContext,
    options?: BookRideSeatOptions,
  ): Promise<string> {
    if (!isValidRideBookingSeats(seats)) {
      return Promise.reject(new RideError('seats_required', 'seats must be a whole number from 1 to 8'));
    }
    if (context?.departsAt) {
      const departs = new Date(context.departsAt).getTime();
      if (!Number.isNaN(departs) && departs <= Date.now()) {
        return Promise.reject(new RideError('ride_departed', 'ride has already departed'));
      }
    }
    if (context?.freeSeats !== undefined && (context.freeSeats <= 0 || seats > context.freeSeats)) {
      return Promise.reject(new RideError('seats_exhausted', 'no seats left on this ride'));
    }
    if (context?.capacity !== undefined && seats > context.capacity) {
      return Promise.reject(new RideError('seats_exhausted', 'requested seats exceed ride capacity'));
    }
    return this.repo.bookSeat(listingId, seats, options?.requestedMeetingPoint ?? null);
  }
}

export class ListRideBookingsUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(listingId: string): Promise<RideBooking[]> {
    return this.repo.listForRide(listingId);
  }
}

export interface ApproveRideBookingContext {
  readonly capacity: number;
  readonly bookings: readonly RideBooking[];
}

export class ApproveRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  /** Rejects non-reserved bookings and approvals that would exceed ride capacity. */
  execute(handoffId: string, context?: ApproveRideBookingContext): Promise<void> {
    if (context) {
      const target = context.bookings.find((b) => b.handoffId === handoffId);
      if (target) {
        if (!canPerformBookingAction(target.status, 'approve')) {
          return Promise.reject(new RideError('invalid_status', 'only reserved bookings can be approved'));
        }
        if (!canApproveRideBooking(context.capacity, context.bookings, target)) {
          return Promise.reject(new RideError('seats_exhausted', 'accepting this booking would exceed ride capacity'));
        }
      }
    }
    return this.repo.approve(handoffId);
  }
}

export interface DeclineRideBookingContext {
  readonly bookings?: readonly RideBooking[];
}

export class DeclineRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string, context?: DeclineRideBookingContext): Promise<void> {
    if (context?.bookings) {
      const target = context.bookings.find((b) => b.handoffId === handoffId);
      if (target && !canPerformBookingAction(target.status, 'decline')) {
        return Promise.reject(new RideError('invalid_status', 'only reserved bookings can be declined'));
      }
    }
    return this.repo.decline(handoffId);
  }
}

export interface CancelRideBookingContext {
  readonly status?: RideBookingStatus | 'cancelled' | string;
  readonly bookings?: readonly RideBooking[];
}

export class CancelRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string, context?: CancelRideBookingContext): Promise<void> {
    const status = context?.status ?? context?.bookings?.find((b) => b.handoffId === handoffId)?.status;
    if (status && !canPerformBookingAction(status, 'cancel')) {
      return Promise.reject(new RideError('invalid_status', 'only reserved or confirmed bookings can be cancelled'));
    }
    return this.repo.cancel(handoffId);
  }
}

export interface CompleteRideTripContext {
  readonly status?: RideBookingStatus | 'cancelled' | string;
  readonly bookings?: readonly RideBooking[];
  readonly departsAt?: string | null;
  readonly now?: Date;
}

export class CompleteRideTripUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(handoffId: string, context?: CompleteRideTripContext): Promise<void> {
    const status = context?.status ?? context?.bookings?.find((b) => b.handoffId === handoffId)?.status;
    if (status && !canPerformBookingAction(status, 'complete')) {
      return Promise.reject(new RideError('invalid_status', 'only reserved or confirmed bookings can be completed'));
    }
    if (context?.departsAt && !isRideTripCompletable(context.departsAt, context.now)) {
      return Promise.reject(new RideError('ride_not_started', 'ride can be marked completed from an hour before departure'));
    }
    return this.repo.complete(handoffId);
  }
}

export class CompleteRideListingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  execute(listingId: string): Promise<number> {
    return this.repo.completeRide(listingId);
  }
}

export interface ReinstateRideBookingContext {
  /** The ride the booking belongs to; when given, the RPC's preconditions are checked first. */
  readonly ride?: RideBookingRideContext;
  readonly now?: Date;
}

export class ReinstateRideBookingUseCase {
  constructor(private readonly repo: IRideBookingRepository) {}
  /** Rejects with the RPC's own code when the ride cannot take the booking back now. */
  execute(handoffId: string, context?: ReinstateRideBookingContext): Promise<void> {
    const ride = context?.ride;
    const target = ride?.bookings.find((b) => b.handoffId === handoffId);
    const blocker = ride && target ? rideReinstateBlocker(target, ride, context?.now) : null;
    if (blocker) {
      return Promise.reject(new RideError(blocker, `booking cannot be reinstated: ${blocker}`));
    }
    return this.repo.reinstate(handoffId);
  }
}
