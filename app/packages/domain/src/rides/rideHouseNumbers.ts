// FR-RIDE-003 AC9: an optional house number for a street origin / destination, kept private —
// the public ride shows the official place only (D71); the driver and approved passengers see
// the full address and navigate to it.
import type { RidePlace, RideRoute } from './RidePlace';

export type RideHouseNumberEnd = 'origin' | 'dest';
export type RideHouseNumbers = Readonly<Partial<Record<RideHouseNumberEnd, string>>>;

/** Digits (1–4) with an optional Hebrew or Latin letter, e.g. "12", "120B". Same rule as the server. */
const HOUSE_NUMBER = /^[0-9]{1,4}[\u05D0-\u05EAA-Za-z]?$/;
export const RIDE_HOUSE_NUMBER_MAX_LENGTH = 5;

export function isValidRideHouseNumber(raw: string): boolean {
  return HOUSE_NUMBER.test(raw.trim());
}

/** The numbers worth saving: valid, trimmed, and only on ends that are a street. */
export function rideHouseNumbersForSubmit(route: RideRoute, raw: RideHouseNumbers): RideHouseNumbers {
  const out: Partial<Record<RideHouseNumberEnd, string>> = {};
  for (const end of ['origin', 'dest'] as const) {
    const value = raw[end]?.trim();
    if (value && route[end]?.kind === 'street' && isValidRideHouseNumber(value)) out[end] = value;
  }
  return out;
}

/** True when some number was typed that cannot be saved (invalid); blank is fine. */
export function hasInvalidRideHouseNumber(raw: RideHouseNumbers): boolean {
  return (['origin', 'dest'] as const).some((end) => {
    const value = raw[end]?.trim();
    return Boolean(value) && !isValidRideHouseNumber(value!);
  });
}

/**
 * A street place with its house number: "Herzl, Tel Aviv" + "12" → "Herzl 12, Tel Aviv".
 * Any other place, or no number, keeps its label.
 */
export function rideAddressLabel(place: RidePlace, houseNumber?: string | null): string {
  const number = houseNumber?.trim();
  if (place.kind !== 'street' || !number) return place.label;
  const comma = place.label.indexOf(', ');
  return comma < 0 ? `${place.label} ${number}` : `${place.label.slice(0, comma)} ${number}${place.label.slice(comma)}`;
}
