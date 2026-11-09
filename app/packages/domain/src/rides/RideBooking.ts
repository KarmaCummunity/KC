// A seat booking on a ride offer (rides world on the generic handoff stage).
// Spec: docs/spec/05_giving_worlds.md §5.3 step 3 — the driver sees every booking and
// approves or declines each (D73); unapproved bookings expire (D96). Gap G47.

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

/** True when the driver may call `reinstate_ride_booking` for this list row. */
export function canReinstateRideBooking(booking: RideBooking): boolean {
  return booking.status === RIDE_BOOKING_CANCELLED_STATUS
    && booking.cancelReason != null
    && REINSTATE_CANCEL_REASONS.has(booking.cancelReason);
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
 * Seats not yet committed to confirmed or completed bookings.
 * A driver cannot approve a waiting booking whose requested seats exceed this value.
 */
export function getRideRemainingCapacity(capacity: number, bookings: readonly RideBooking[]): number {
  const committed = bookings
    .filter((b) => b.status === 'confirmed' || b.status === 'handed_over')
    .reduce((sum, b) => sum + b.seats, 0);
  return Math.max(0, Math.max(0, capacity) - committed);
}

/**
 * True when the target booking is waiting (reserved) and its requested seats do not
 * exceed remaining ride capacity (prevents accepting beyond capacity).
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
  return target.seats <= getRideRemainingCapacity(capacity, bookings);
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
 * Whether the action is permitted on a booking in this status.
 */
export function canPerformBookingAction(
  status: RideBookingStatus | 'cancelled',
  action: RideBookingAction,
  ratedByMe = false,
): boolean {
  switch (action) {
    case 'approve':
    case 'decline':
      return status === 'reserved';
    case 'cancel':
      return status === 'reserved' || status === 'confirmed';
    case 'complete':
      return status === 'confirmed' || status === 'reserved';
    case 'rate':
      return status === 'handed_over' && !ratedByMe;
    default:
      return false;
  }
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
