// A seat booking on a ride offer (rides world on the generic handoff stage).
// Spec: docs/spec/05_giving_worlds.md §5.3 step 3 — the driver sees every booking and
// approves or declines each (D73); unapproved bookings expire (D96). Gap G47.
// Status moves follow the `ride_booking` kernel machine (fsm/machines/rideBooking.ts, 0694).
import { hasEdge } from '../fsm/machine';
import { rideBookingMachine } from '../fsm/machines/rideBooking';

/** Active booking states on a ride offer. */
export const RIDE_BOOKING_STATUSES = ['reserved', 'confirmed', 'handed_over'] as const;
export type RideBookingStatus = (typeof RIDE_BOOKING_STATUSES)[number];

/** Driver list may include a recently cancelled row the owner can reinstate. */
export const RIDE_BOOKING_CANCELLED_STATUS = 'cancelled' as const;
export type RideBookingListStatus = RideBookingStatus | typeof RIDE_BOOKING_CANCELLED_STATUS;

/** Upper bound of seats one passenger can book at once (mirrors `book_ride_seat`). */
export const RIDE_BOOKING_MAX_SEATS = 8;

export interface RideBooking {
  readonly handoffId: string;
  readonly recipientId: string;
  readonly passengerName: string;
  readonly avatarUrl: string | null;
  readonly seats: number;
  readonly status: RideBookingListStatus;
  readonly reservedAt: string;
  /** Set when `status` is `cancelled` and the driver may reinstate this row. */
  readonly cancelReason?: string | null;
  /** Approval deadline: 12 hours after booking or departure, whichever is earlier (D96). */
  readonly confirmBy: string | null;
  /** True once the driver rated this passenger after the trip (spec 07 §7.7). */
  readonly ratedByMe: boolean;
  /** Passenger-requested meeting point label, shown to the driver before approval. */
  readonly requestedStopLabel: string | null;
}

/** How a ride's seats are split between waiting, approved and completed bookings. */
export interface RideSeatSummary {
  readonly capacity: number;
  readonly waiting: number;
  readonly approved: number;
  readonly completed: number;
  /** Seats still open for booking; never negative. */
  readonly free: number;
}

export function isRideBookingStatus(value: string): value is RideBookingStatus {
  return (RIDE_BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isRideBookingListStatus(value: string): value is RideBookingListStatus {
  return isRideBookingStatus(value) || value === RIDE_BOOKING_CANCELLED_STATUS;
}

const REINSTATE_CANCEL_REASONS = new Set(['declined', 'driver_cancelled']);

/**
 * True when this cancelled row is one the driver may bring back: they declined it or cancelled
 * it themselves. Whether the ride can take it back now is `rideReinstateBlocker`.
 */
export function canReinstateRideBooking(booking: RideBooking): boolean {
  return booking.status === RIDE_BOOKING_CANCELLED_STATUS
    && booking.cancelReason != null
    && REINSTATE_CANCEL_REASONS.has(booking.cancelReason);
}

/** The ride a driver's booking list belongs to, as the reinstate and completion rules read it. */
export interface RideBookingRideContext {
  /** The ride post's listing status (`open`, `closed`, …). */
  readonly listingStatus: string;
  /** Departure (ISO), or null when the ride has none. */
  readonly departsAt: string | null;
  /** Seats the driver offered. */
  readonly capacity: number;
  /** Every booking on the ride, the target included. */
  readonly bookings: readonly RideBooking[];
}

/** Why `reinstate_ride_booking` would refuse; the codes are the RPC's own (0667). */
export type RideReinstateBlocker =
  | 'listing_not_available'
  | 'invalid_status'
  | 'already_booked'
  | 'ride_departed'
  | 'ride_seats_exhausted';

/**
 * The first reason `reinstate_ride_booking` would refuse this row, in the RPC's order, or null
 * when the driver can reinstate it now: the ride is open, the row was declined or driver-cancelled,
 * the passenger holds no other live booking on it, the ride has not departed, and the seats fit.
 */
export function rideReinstateBlocker(
  booking: RideBooking,
  ride: RideBookingRideContext,
  now: Date = new Date(),
): RideReinstateBlocker | null {
  if (ride.listingStatus !== 'open') return 'listing_not_available';
  if (!canReinstateRideBooking(booking)) return 'invalid_status';
  const otherLiveBooking = ride.bookings.some((b) =>
    b.handoffId !== booking.handoffId
    && b.recipientId === booking.recipientId
    && (b.status === 'reserved' || b.status === 'confirmed'));
  if (otherLiveBooking) return 'already_booked';
  const departs = ride.departsAt ? Date.parse(ride.departsAt) : Number.NaN;
  if (Number.isFinite(departs) && departs <= now.getTime()) return 'ride_departed';
  // A cancelled row holds no seats, so the summary's free seats are what it would take.
  if (booking.seats > summarizeRideSeats(ride.capacity, ride.bookings).free) return 'ride_seats_exhausted';
  return null;
}

/** True when `seats` is a whole number a single booking may request. */
export function isValidRideBookingSeats(seats: number): boolean {
  return Number.isInteger(seats) && seats >= 1 && seats <= RIDE_BOOKING_MAX_SEATS;
}

/**
 * Splits a ride's capacity across its bookings. Every listed booking holds its seats,
 * as on the server (`book_ride_seat` counts reserved, confirmed and handed-over seats).
 */
export function summarizeRideSeats(capacity: number, bookings: readonly RideBooking[]): RideSeatSummary {
  const seatsIn = (status: RideBookingStatus) =>
    bookings.filter((b) => b.status === status).reduce((sum, b) => sum + b.seats, 0);
  const waiting = seatsIn('reserved');
  const approved = seatsIn('confirmed');
  const completed = seatsIn('handed_over');
  const safeCapacity = Math.max(0, capacity);
  return {
    capacity: safeCapacity,
    waiting,
    approved,
    completed,
    free: Math.max(0, safeCapacity - waiting - approved - completed),
  };
}

/**
 * True when the target booking is waiting (reserved) and its seats fit beside every other
 * booking that holds seats — reserved, confirmed or completed — as `confirm_ride_booking`
 * counts them (`post_handoff_seats_taken`, 0558). Waiting bookings can outnumber the seats
 * after the driver lowers them.
 */
export function canApproveRideBooking(
  capacity: number,
  bookings: readonly RideBooking[],
  targetOrId: RideBooking | string,
): boolean {
  const target = typeof targetOrId === 'string'
    ? bookings.find((b) => b.handoffId === targetOrId)
    : targetOrId;
  if (!target || target.status !== 'reserved') return false;
  const others = bookings.filter((b) => b.handoffId !== target.handoffId);
  return target.seats <= summarizeRideSeats(capacity, others).free;
}

/**
 * True when a passenger can request `requestedSeats` on this ride: seats are valid
 * and do not exceed free seats open for booking.
 */
export function canBookRideSeats(
  capacity: number,
  bookings: readonly RideBooking[],
  requestedSeats: number,
): boolean {
  if (!isValidRideBookingSeats(requestedSeats)) return false;
  const summary = summarizeRideSeats(capacity, bookings);
  return summary.free > 0 && requestedSeats <= summary.free;
}

export type RideBookingAction = 'approve' | 'decline' | 'cancel' | 'complete' | 'rate';

/**
 * The status each driver action moves a booking to. Two actions share a target, so they also
 * name their only source: approving is the waiting booking's move to confirmed (a cancelled one
 * comes back through reinstate), and declining is the waiting booking's cancel.
 */
const ACTION_MOVES: Readonly<Record<Exclude<RideBookingAction, 'rate'>, {
  readonly to: RideBookingListStatus;
  readonly onlyFrom?: RideBookingListStatus;
}>> = {
  approve: { to: 'confirmed', onlyFrom: 'reserved' },
  decline: { to: 'cancelled', onlyFrom: 'reserved' },
  cancel: { to: 'cancelled' },
  complete: { to: 'handed_over' },
};

/**
 * Whether the action is permitted on a booking in this status: its move must be an edge of the
 * `ride_booking` machine (a same-status write is not an action). Rating is not a move: a
 * completed booking is rated once.
 */
export function canPerformBookingAction(
  status: RideBookingListStatus,
  action: RideBookingAction,
  ratedByMe = false,
): boolean {
  if (action === 'rate') return status === 'handed_over' && !ratedByMe;
  const move = ACTION_MOVES[action];
  // An action outside the union (an untyped caller) is never permitted.
  if (move === undefined) return false;
  if (move.onlyFrom !== undefined && status !== move.onlyFrom) return false;
  return hasEdge(rideBookingMachine, status, move.to);
}

/**
 * A trip can be marked completed from 1 hour before departure onward (mirrors 0453).
 */
export function isRideTripCompletable(
  departsAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!departsAtIso) return true;
  const departsAt = new Date(departsAtIso).getTime();
  if (Number.isNaN(departsAt)) return true;
  const oneHourBefore = departsAt - 60 * 60 * 1000;
  return now.getTime() >= oneHourBefore;
}

/** True when the driver can complete this booking's trip now (`complete_ride_trip`, 0667). */
export function canCompleteRideBooking(
  booking: RideBooking,
  departsAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return canPerformBookingAction(booking.status, 'complete') && isRideTripCompletable(departsAtIso, now);
}
