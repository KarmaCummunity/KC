// A recurring ride (docs/spec/05_giving_worlds.md §5.3 step 1 "recurring ride", FR-RIDE-046):
// the member publishes a series — weekdays, a departure time (Israel time) and an optional end
// date — and the server publishes one ordinary ride listing per upcoming day (an "occurrence").
// An occurrence carries a marker with its series, so every screen can say "every Sun–Thu at 07:30"
// from the listing's details alone.
import type { RideErrorCode } from './RideError';

/** Days ahead the server keeps occurrences published for (0529 `ride_series_materialize`). */
export const RIDE_SERIES_LOOKAHEAD_DAYS = 30;

/** Sunday … Saturday, as JavaScript's `Date.getDay()` numbers them. */
export const RIDE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type RideWeekday = (typeof RIDE_WEEKDAYS)[number];

export const RIDE_SERIES_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type RideSeriesStatus = (typeof RIDE_SERIES_STATUSES)[number];

/** When a series runs. `time` is `HH:mm` in Israel time; `endsOn` is an ISO date or null for open-ended. */
export interface RideSeriesSchedule {
  readonly weekdays: readonly RideWeekday[];
  readonly time: string;
  readonly endsOn: string | null;
}

export interface RideSeries {
  readonly id: string;
  readonly direction: 'give' | 'request';
  readonly title: string;
  /** The ride details every occurrence starts from (route, seats, cost…), without the times. */
  readonly details: Record<string, unknown>;
  readonly schedule: RideSeriesSchedule;
  /** Estimated ride length; an occurrence's estimated end is its departure plus this. */
  readonly durationMinutes: number | null;
  readonly status: RideSeriesStatus;
}

export interface CreateRideSeriesInput {
  readonly kindId: string;
  readonly direction: 'give' | 'request';
  readonly title: string;
  readonly summary: string | null;
  readonly details: Record<string, unknown>;
  readonly schedule: RideSeriesSchedule;
  readonly durationMinutes: number | null;
}

/** What `create_ride_series` hands back: the series and its soonest occurrence to open. */
export interface CreatedRideSeries {
  readonly seriesId: string;
  readonly firstListingId: string;
}

/** One upcoming date of a recurring ride, as `list_ride_series_occurrences` returns it. */
export interface RideSeriesOccurrence {
  readonly listingId: string;
  readonly departsAt: string;
  /** Offers: seats still free. Null for requests. */
  readonly seatsLeft: number | null;
  /** Requests: passengers asking. Null for offers. */
  readonly passengers: number | null;
}

/** The marker an occurrence carries in `details.ride_series` (0529). */
export interface RideSeriesMarker {
  readonly id: string;
  /** The occurrence's day, ISO date. */
  readonly on: string;
  readonly weekdays: readonly RideWeekday[];
  /** Departure `HH:mm`, Israel time. */
  readonly time: string;
}

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isRideWeekday(value: unknown): value is RideWeekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/** The server's bit mask of some weekdays (bit 0 = Sunday); 0 for none. */
export function rideWeekdaysToMask(days: readonly number[]): number {
  return [...new Set(days.filter(isRideWeekday))].reduce<number>((mask, d) => mask | (1 << d), 0);
}

/** The weekdays of a server bit mask, Sunday first. */
export function rideWeekdaysFromMask(mask: number): RideWeekday[] {
  return RIDE_WEEKDAYS.filter((d) => (mask & (1 << d)) !== 0);
}

/**
 * Consecutive weekdays grouped into `[first, last]` runs for a compact label:
 * Sun–Thu → `[[0, 4]]`; Sun, Tue, Thu → `[[0, 0], [2, 2], [4, 4]]`. Sunday starts the week.
 */
export function rideWeekdayRuns(days: readonly RideWeekday[]): Array<[RideWeekday, RideWeekday]> {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: Array<[RideWeekday, RideWeekday]> = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[1] === day - 1) last[1] = day;
    else runs.push([day, day]);
  }
  return runs;
}

/** `HH:mm` of a date in the device's local time (the app's audience lives in Israel time). */
export function localTimeHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` of a date in the device's local time. */
export function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Whole minutes from the departure to the estimated end of a ride's details, or null. */
export function rideDurationMinutes(details: Record<string, unknown>): number | null {
  const departs = Date.parse(String(details.departs_at ?? ''));
  const arrives = Date.parse(String(details.arrives_at ?? ''));
  if (Number.isNaN(departs) || Number.isNaN(arrives) || arrives <= departs) return null;
  return Math.round((arrives - departs) / 60_000);
}

/**
 * The first problem with a schedule, as a ride error code, or null when it can be published:
 * at least one weekday, a valid `HH:mm`, and an end date not before `today` (local ISO date).
 */
export function rideSeriesScheduleError(schedule: RideSeriesSchedule, today: string): RideErrorCode | null {
  if (schedule.weekdays.length === 0 || !schedule.weekdays.every(isRideWeekday)) return 'series_weekdays_required';
  if (!TIME_HHMM.test(schedule.time)) return 'series_time_invalid';
  if (schedule.endsOn !== null && (!ISO_DATE.test(schedule.endsOn) || schedule.endsOn < today)) return 'series_ends_in_past';
  return null;
}

/** The series marker of an occurrence's details; null on a single ride or a malformed marker. */
export function readRideSeriesMarker(details: Record<string, unknown>): RideSeriesMarker | null {
  const raw = details.ride_series;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.on !== 'string' || typeof m.time !== 'string') return null;
  if (typeof m.weekdays !== 'number' || !TIME_HHMM.test(m.time)) return null;
  const weekdays = rideWeekdaysFromMask(m.weekdays);
  return weekdays.length > 0 ? { id: m.id, on: m.on, weekdays, time: m.time } : null;
}
