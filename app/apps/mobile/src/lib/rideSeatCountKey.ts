// The copy key for a ride's seat count on cards (#1412 / #1784): "N seats" on an offer,
// "N passengers" on a request. i18next JSON v4 resolves `_one` / `_two` / `_other` from
// the base key when `t` is called with `{ count }`.

/** Which count a ride card shows: free seats on an offer, passengers on a request. */
export type RideSeatCountKind = 'seats' | 'passengers';

/** The `cards.*` base key for seats or passengers; pass `{ count }` to `t` for the plural. */
export function rideSeatCountKey(kind: RideSeatCountKind): string {
  return `cards.${kind}`;
}
