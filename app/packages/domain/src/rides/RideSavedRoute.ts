// A saved route: follow from → to and hear about new rides on it
// (docs/spec/05_giving_worlds.md §5.3 step 4, D74; gap G48). Places are official (D71).
import type { RidePlace } from './RidePlace';

/** Routes one person may follow at once (enforced by the server too). */
export const RIDE_SAVED_ROUTES_MAX = 10;

/** A passenger follows offers; a driver follows requests. */
export type RideRouteWants = 'offers' | 'requests';

/** Hour windows a route can be narrowed to (Israel time), `[from, to]` as HH:mm. */
export const RIDE_TIME_WINDOWS = {
  morning: ['06:00', '10:00'],
  midday: ['10:00', '15:00'],
  evening: ['15:00', '21:00'],
} as const;
export type RideTimeWindow = keyof typeof RIDE_TIME_WINDOWS;

export interface RideSavedRoute {
  readonly id: string;
  readonly wants: RideRouteWants;
  readonly origin: RidePlace;
  readonly dest: RidePlace;
  /** Followed weekdays, 0 = Sunday … 6 = Saturday; null = every day. */
  readonly weekdays: readonly number[] | null;
  readonly timeWindow: RideTimeWindow | null;
}

export interface SaveRideRouteInput {
  readonly wants: RideRouteWants;
  readonly origin: RidePlace;
  readonly dest: RidePlace;
  readonly weekdays: readonly number[] | null;
  readonly timeWindow: RideTimeWindow | null;
}

/** Weekdays as the server's bit mask (bit 0 = Sunday); no days or all seven = every day (null). */
export function weekdaysToMask(days: readonly number[] | null): number | null {
  const valid = [...new Set((days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (valid.length === 0 || valid.length === 7) return null;
  return valid.reduce((mask, d) => mask | (1 << d), 0);
}

/** The server's bit mask as sorted weekdays; null stays "every day". */
export function maskToWeekdays(mask: number | null): number[] | null {
  if (mask == null || mask <= 0 || mask >= 127) return null;
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask & (1 << d)) !== 0);
}

/** The named window for stored hours, or null for "any hour" (or hours no window matches). */
export function timeWindowFor(from: string | null, to: string | null): RideTimeWindow | null {
  if (!from || !to) return null;
  const match = (Object.keys(RIDE_TIME_WINDOWS) as RideTimeWindow[]).find(
    (w) => from.startsWith(RIDE_TIME_WINDOWS[w][0]) && to.startsWith(RIDE_TIME_WINDOWS[w][1]),
  );
  return match ?? null;
}
