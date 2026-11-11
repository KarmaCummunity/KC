// "Drive now" in the rides create form (FR-RIDE-003 AC6, AC8): the origin from the device
// location, and opening navigation right after a driver publishes a ride that starts here, now.
import { pinDistanceKm } from '../marketplace/mapPins';
import type { RidePlace, RideRoute } from './RidePlace';

/** Farther than this from every official city, the device is not "here" for a ride origin. */
export const RIDE_FROM_HERE_MAX_KM = 30;

/** The official city nearest the device, or null when none lies within `RIDE_FROM_HERE_MAX_KM`. */
export function rideOriginFromHere(
  here: { lat: number; lng: number },
  places: readonly RidePlace[],
): RidePlace | null {
  let best: RidePlace | null = null;
  let bestKm = RIDE_FROM_HERE_MAX_KM;
  for (const p of places) {
    if (p.kind !== 'city') continue;
    const km = pinDistanceKm(here, p);
    if (km <= bestKm) {
      best = p;
      bestKm = km;
    }
  }
  return best;
}

/** The first place the driver heads to: the first meeting point, else the destination. */
export function rideNextStop(route: RideRoute): RidePlace | null {
  return route.meetingPoints[0] ?? route.dest;
}

export interface RidePublishedFlags {
  readonly isOffer: boolean;
  readonly originFromHere: boolean;
  readonly leaveNow: boolean;
  readonly recurring: boolean;
}

/** Navigation opens only for a single ride offer leaving now from the device's location. */
export function shouldNavigateAfterRidePublish(flags: RidePublishedFlags): boolean {
  return flags.isOffer && flags.originFromHere && flags.leaveNow && !flags.recurring;
}
