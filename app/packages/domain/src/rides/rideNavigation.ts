// "Navigate" links for a ride place — Waze, Google Maps, Apple Maps
// (docs/spec/05_giving_worlds.md §5.3 step 5, D72; gap G46).
// Cities and junctions navigate to their catalog coordinates. A street place is pinned at its
// city (streets have no coordinates), so it navigates by its address text instead.
import type { RidePlace } from './RidePlace';
import { rideAddressLabel } from './rideHouseNumbers';

export const RIDE_NAVIGATION_APPS = ['waze', 'google', 'apple'] as const;
export type RideNavigationApp = (typeof RIDE_NAVIGATION_APPS)[number];

/**
 * Universal links: each opens the app when installed and its web page otherwise. A street's
 * private house number (FR-RIDE-003 AC9), when known, makes the address exact.
 */
export function rideNavigationUrl(app: RideNavigationApp, place: RidePlace, houseNumber?: string | null): string {
  const byAddress = place.kind === 'street';
  const coords = `${place.lat},${place.lng}`;
  const address = encodeURIComponent(rideAddressLabel(place, houseNumber));
  switch (app) {
    case 'waze':
      return byAddress
        ? `https://waze.com/ul?q=${address}&navigate=yes`
        : `https://waze.com/ul?ll=${coords}&navigate=yes`;
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${byAddress ? address : coords}`;
    case 'apple':
      return `https://maps.apple.com/?daddr=${byAddress ? address : coords}`;
  }
}

/**
 * The navigation apps worth offering on a platform: Apple Maps exists only on Apple devices;
 * Waze and Google Maps everywhere.
 */
export function rideNavigationAppsFor(platform: string): readonly RideNavigationApp[] {
  return platform === 'ios' ? RIDE_NAVIGATION_APPS : RIDE_NAVIGATION_APPS.filter((a) => a !== 'apple');
}
