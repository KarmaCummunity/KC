// Shared card + ride detail strings. Hebrew.
export const cardsHe = {
  // Hebrew CLDR needs `_two` for count=2; `_other` covers 0 and 3+.
  seats_one: 'מקום אחד',
  seats_two: 'שני מקומות',
  seats_other: '{{count}} מקומות',
  passengers_one: 'נוסע/ת אחד/ת',
  passengers_two: 'שני נוסעים',
  passengers_other: '{{count}} נוסעים',
  rideOffer: 'מציע/ה טרמפ',
  rideRequest: 'מחפש/ת טרמפ',
  from: 'מוצא',
  to: 'יעד',
  departs: 'יציאה',
  unknownPlace: 'לא צוין',
  costShare: 'השתתפות בהוצאות: {{amount}} ₪',
  free: 'בחינם',
  routeTitle: 'מסלול',
  closed: 'סגור',
  openFullPost: 'לפוסט המלא',
} as const;
