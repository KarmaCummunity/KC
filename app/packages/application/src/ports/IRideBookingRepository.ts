import type { RideBooking } from '@kc/domain';

/**
 * Seat bookings on a ride offer — the rides world on the generic handoff stage
 * (docs/spec/05_giving_worlds.md §5.3 step 3, D73; gap G47).
 * Every write returns once the server accepted it; the server notifies the other side.
 */
export interface IRideBookingRepository {
  /** Passenger books `seats` on an open ride offer; resolves to the new booking id. */
  bookSeat(
    listingId: string,
    seats: number,
    requestedMeetingPoint?: Record<string, unknown> | null,
  ): Promise<string>;
  /** Driver only: every waiting, approved or completed booking on the ride. */
  listForRide(listingId: string): Promise<RideBooking[]>;
  /** Driver approves a waiting booking. */
  approve(handoffId: string): Promise<void>;
  /** Driver declines a waiting booking, freeing its seats. */
  decline(handoffId: string): Promise<void>;
  /** Either side cancels a waiting or approved booking. */
  cancel(handoffId: string): Promise<void>;
  /** Either side marks the trip done (from 1 hour before departure); earns karma. */
  complete(handoffId: string): Promise<void>;
  /** Driver only: completes confirmed bookings and closes the ride offer. */
  completeRide(listingId: string): Promise<number>;
  /** Driver only: puts back a passenger they declined or cancelled by mistake. */
  reinstate(handoffId: string): Promise<void>;
}
