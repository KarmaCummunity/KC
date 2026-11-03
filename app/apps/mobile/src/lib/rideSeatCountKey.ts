// The copy key for a ride's seat count on cards (#1412): "N seats" on an offer, "N passengers"
// on a request. i18n runs with `compatibilityJSON: 'v3'`, which does not resolve the `_one` /
// `_other` plural suffixes the `cards` copy uses, so the plural form is chosen here explicitly.

/** Which count a ride card shows: free seats on an offer, passengers on a request. */
export type RideSeatCountKind = 'seats' | 'passengers';

/** The `cards.*` key for `count` seats or passengers, with its plural form already chosen. */
export function rideSeatCountKey(kind: RideSeatCountKind, count: number): string {
  return `cards.${kind}_${count === 1 ? 'one' : 'other'}`;
}
