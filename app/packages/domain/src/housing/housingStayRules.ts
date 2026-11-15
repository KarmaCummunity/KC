// Housing stay rules the app checks before calling the server, and which actions each side
// may take on a booking at a given moment. They mirror the server exactly (migrations
// 0602–0603); the server stays the source of truth.
// Spec: docs/spec/requirements/21_housing.md FR-HOUSING-015 (request), 018 (cancel), 019 (complete),
// 020 (no-show), 012 AC2 (address window); limits S54.
import { allowsMove } from '../fsm/machine';
import { housingBookingMachine } from '../fsm/machines/housingBooking';
import type { HousingErrorCode } from './HousingError';
import type {
  HousingBookingStatus,
  HousingGuestStay,
  HousingHostBooking,
  HousingOfferTerms,
  HousingStayRequestInput,
} from './HousingStay';

/** A guest party never exceeds 8 people (`housing_booking_details_party`). */
export const HOUSING_MAX_PARTY = 8;
/** Check-in at most 180 days ahead (S54). */
export const HOUSING_MAX_DAYS_AHEAD = 180;
export const HOUSING_MESSAGE_MAX = 500;
export const HOUSING_NOTE_MAX = 300;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `yyyy-MM-dd` day as a UTC timestamp, or null when it is not a real calendar day. */
function dayValue(day: string): number | null {
  if (!ISO_DAY.test(day)) return null;
  const value = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(value) || new Date(value).toISOString().slice(0, 10) !== day ? null : value;
}

/** Nights between two `yyyy-MM-dd` days (check-out minus check-in); null for an invalid day. */
export function housingNights(checkInDate: string, checkOutDate: string): number | null {
  const start = dayValue(checkInDate);
  const end = dayValue(checkOutDate);
  return start === null || end === null ? null : Math.round((end - start) / DAY_MS);
}

/** The Israel calendar day of `now` as `yyyy-MM-dd` — the server's `housing_today()`. */
export function housingToday(now: Date): string {
  // en-CA formats a date as yyyy-MM-dd; the time zone makes it the Israel day, not the device's.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Reads the terms a request is checked against from a stay offer's `details`. */
export function housingOfferTerms(details: Readonly<Record<string, unknown>>): HousingOfferTerms {
  const int = (key: string, fallback: number) =>
    typeof details[key] === 'number' && Number.isInteger(details[key]) ? (details[key] as number) : fallback;
  return {
    minNights: int('min_nights', 1),
    maxNights: int('max_nights', 30),
    childrenOk: details.children_ok === true,
    capacity: int('capacity', 1),
  };
}

/**
 * The first rule a stay request breaks, or null when it may be sent (FR-HOUSING-015 AC2).
 * `today` is the current Israel day (`yyyy-MM-dd`), the server's `housing_today()`.
 */
export function validateStayRequest(
  input: HousingStayRequestInput,
  terms: HousingOfferTerms,
  today: string,
): HousingErrorCode | null {
  const nights = housingNights(input.checkInDate, input.checkOutDate);
  const ahead = housingNights(today, input.checkInDate);
  if (nights === null || ahead === null || ahead < 0 || ahead > HOUSING_MAX_DAYS_AHEAD) {
    return 'housing_dates_invalid';
  }
  if (nights < Math.max(1, terms.minNights) || nights > terms.maxNights) return 'housing_nights_out_of_range';
  const party = input.adults + input.minors;
  if (!Number.isInteger(input.adults) || !Number.isInteger(input.minors) || input.adults < 1 || input.minors < 0
    || party > HOUSING_MAX_PARTY || party > terms.capacity) {
    return 'housing_capacity_exceeded';
  }
  if (input.minors > 0 && !terms.childrenOk) return 'housing_policy_mismatch';
  if (input.minors > 0 && !input.minorsGuardianAck) return 'housing_minor_unaccompanied';
  const message = input.message.trim();
  if (message.length < 1 || message.length > HOUSING_MESSAGE_MAX) return 'housing_message_required';
  return null;
}

export type HousingHostAction = 'approve' | 'decline' | 'cancel' | 'complete' | 'no_show';
export type HousingGuestAction = 'cancel' | 'show_address' | 'rate';

/** Before check-in a booking can still be cancelled (after it, it is completed instead). */
function beforeStart(startsAt: string, now: Date): boolean {
  return now.getTime() < Date.parse(startsAt);
}

/** What the host may do with a booking right now (FR-HOUSING-016, 018, 019, 020). */
export function hostBookingActions(booking: HousingHostBooking, now: Date): readonly HousingHostAction[] {
  const at = now.getTime();
  const start = Date.parse(booking.startsAt);
  const end = Date.parse(booking.endsAt);
  // Which moves the graph gives the host from this status; the clock then narrows them.
  const may = (to: HousingBookingStatus): boolean => allowsMove(housingBookingMachine, booking.status, to, 'owner');
  // A request still waits for an answer while it can be approved: both answers are offered.
  if (may('confirmed')) return may('cancelled') ? ['approve', 'decline'] : ['approve'];
  const actions: HousingHostAction[] = [];
  if (may('cancelled') && beforeStart(booking.startsAt, now)) actions.push('cancel');
  if (may('handed_over') && at >= start && at <= end + 7 * DAY_MS) actions.push('complete');
  if (may('no_show') && at >= start + 3 * HOUR_MS && at <= start + DAY_MS) actions.push('no_show');
  return actions;
}

/** What the guest may do with their own booking right now (FR-HOUSING-012, 018, 021). */
export function guestStayActions(stay: HousingGuestStay, now: Date): readonly HousingGuestAction[] {
  const actions: HousingGuestAction[] = [];
  // The guest cancels where the graph lets a recipient cancel (a request or an approved stay).
  const mayCancel = allowsMove(housingBookingMachine, stay.status, 'cancelled', 'recipient');
  if (mayCancel && beforeStart(stay.startsAt, now)) actions.push('cancel');
  if (stay.canViewAddress) actions.push('show_address');
  // Ratings open after completion, for 7 days (FR-HOUSING-021 AC1).
  if (stay.status === 'handed_over' && !stay.ratedByMe) actions.push('rate');
  return actions;
}

/**
 * Whether cancelling a confirmed stay now counts as late (a trust signal, never shown):
 * within 24 h of check-in for the guest, within 48 h for the host (FR-HOUSING-018).
 */
export function isLateHousingCancel(startsAt: string, side: 'guest' | 'host', now: Date): boolean {
  const window = (side === 'host' ? 48 : 24) * HOUR_MS;
  return Date.parse(startsAt) - now.getTime() < window;
}
