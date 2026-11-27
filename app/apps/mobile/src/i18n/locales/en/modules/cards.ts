// Shared card + ride detail strings. English.
export const cardsEn = {
  // English only uses `_one` / `_other`; `_two` kept for locale-parity with Hebrew.
  seats_one: '1 seat',
  seats_two: '2 seats',
  seats_other: '{{count}} seats',
  passengers_one: '1 passenger',
  passengers_two: '2 passengers',
  passengers_other: '{{count}} passengers',
  rideOffer: 'Offering a ride',
  rideRequest: 'Looking for a ride',
  from: 'From',
  to: 'To',
  departs: 'Departs',
  unknownPlace: 'Not specified',
  costShare: 'Cost share: ₪{{amount}}',
  free: 'Free',
  closed: 'Closed',
  openFullPost: 'Open full post',
  routeTitle: 'Route',
} as const;
