// Quick publish for rides: departure shortcuts, the suggested estimated end, seat bounds and
// the seed for "publish again" / the remembered route (docs/spec/05_giving_worlds.md §5.3
// step 1, D75; approved fill S46; gap G49).
import { pinDistanceKm } from '../marketplace/mapPins';
import { RIDE_ROUTE_DETAIL_KEYS, type RideRoute } from './RidePlace';

export const RIDE_DEFAULT_SEATS = 3;
export const RIDE_MIN_SEATS = 1;
export const RIDE_MAX_SEATS = 8;

/** Estimated end = departure + straight-line distance at this speed + a fixed buffer (S46). */
const AVERAGE_SPEED_KMH = 60;
const ARRIVAL_BUFFER_MINUTES = 15;
const ROUND_TO_MINUTES = 15;
const MINUTE_MS = 60_000;

export const RIDE_DEPARTURE_SHORTCUTS = ['in30', 'in60', 'tomorrow0700'] as const;
export type RideDepartureShortcut = (typeof RIDE_DEPARTURE_SHORTCUTS)[number];

/** The departure a shortcut stands for, in the device's local time. */
export function rideDepartureFromShortcut(shortcut: RideDepartureShortcut, now: Date): Date {
  switch (shortcut) {
    case 'in30':
      return new Date(now.getTime() + 30 * MINUTE_MS);
    case 'in60':
      return new Date(now.getTime() + 60 * MINUTE_MS);
    case 'tomorrow0700': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(7, 0, 0, 0);
      return d;
    }
  }
}

/** Rounds a time up to the next whole quarter of an hour (an exact quarter stays). */
export function roundUpToQuarterHour(at: Date): Date {
  const step = ROUND_TO_MINUTES * MINUTE_MS;
  return new Date(Math.ceil(at.getTime() / step) * step);
}

/** Straight-line length of the route through its meeting points, in km. */
export function rideRouteDistanceKm(route: RideRoute): number {
  if (!route.origin || !route.dest) return 0;
  const path = [route.origin, ...route.meetingPoints, route.dest];
  let km = 0;
  for (let i = 1; i < path.length; i += 1) km += pinDistanceKm(path[i - 1]!, path[i]!);
  return km;
}

/**
 * Suggested estimated end (S46): departure + straight-line distance at 60 km/h + 15 minutes,
 * rounded up to a quarter hour. Null until both ends of the route are known.
 */
export function suggestRideArrival(departsAt: Date, route: RideRoute): Date | null {
  if (!route.origin || !route.dest) return null;
  const minutes = (rideRouteDistanceKm(route) / AVERAGE_SPEED_KMH) * 60 + ARRIVAL_BUFFER_MINUTES;
  return roundUpToQuarterHour(new Date(departsAt.getTime() + minutes * MINUTE_MS));
}

/** Ride details that carry over to the next ride: the route and the offer, never the times. */
const REPUBLISH_KEYS: readonly string[] = [
  ...RIDE_ROUTE_DETAIL_KEYS,
  'seats_available', 'passengers', 'cost_share_ils', 'reward_model', 'cargo_items', 'cargo_food', 'luggage',
];

/** The details to start the next ride from ("publish again" and the remembered route). */
export function rideRepublishSeed(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => REPUBLISH_KEYS.includes(key)));
}
