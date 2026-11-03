// A seat booking on a ride offer (rides world on the generic handoff stage).
// Spec: docs/spec/05_giving_worlds.md §5.3 step 3 — the driver sees every booking and
// approves or declines each (D73); unapproved bookings expire (D96). Gap G47.

/** Booking states the driver manages; cancelled bookings are history and are not listed. */
export const RIDE_BOOKING_STATUSES = ['reserved', 'confirmed', 'handed_over'] as const;
export type RideBookingStatus = (typeof RIDE_BOOKING_STATUSES)[number];

/** Upper bound of seats one passenger can book at once (mirrors `book_ride_seat`). */
export const RIDE_BOOKING_MAX_SEATS = 8;

export interface RideBooking {
  readonly handoffId: string;
  readonly recipientId: string;
  readonly passengerName: string;
  readonly avatarUrl: string | null;
  readonly seats: number;
  readonly status: RideBookingStatus;
  readonly reservedAt: string;
  /** Approval deadline: 12 hours after booking or departure, whichever is earlier (D96). */
  readonly confirmBy: string | null;
  /** True once the driver rated this passenger after the trip (spec 07 §7.7). */
  readonly ratedByMe: boolean;
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

/**
 * Valid state transitions for a ride booking:
 * - reserved -> confirmed (driver approves)
 * - reserved -> handed_over (trip completed)
 * - reserved -> cancelled (declined, expired, cancelled)
 * - confirmed -> handed_over (trip completed)
 * - confirmed -> cancelled (cancelled by passenger or driver)
 * - handed_over & cancelled are terminal.
 */
export function isValidRideBookingTransition(
  from: RideBookingStatus,
  to: RideBookingStatus | 'cancelled',
): boolean {
  if (from === 'reserved') return to === 'confirmed' || to === 'handed_over' || to === 'cancelled';
  if (from === 'confirmed') return to === 'handed_over' || to === 'cancelled';
  return false;
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
