// English — ride places: origin, destination and meeting points, picked only from official
// catalogs — a city (with an optional street) or a junction / interchange (spec 05 §5.3, D71).
export const ridePlaces = {
  fieldOrigin: 'From',
  fieldDest: 'To',
  pickerTitle: 'Choose a place',
  pickerSearch: 'Search a city, junction or interchange',
  pickerEmpty: 'No place by that name',
  pickerError: "We couldn't load the list of places",
  streetOptional: 'Street (optional)',
  meetingPointsTitle: 'Pickup points on the way (up to 3)',
  meetingPointLabel: 'Pickup point {{n}}',
  addMeetingPoint: 'Add a pickup point',
  removeMeetingPoint: 'Remove pickup point',
  // D72 — the ride detail: places in order, each with "navigate", and the route on a map.
  meetingPoint: 'Pickup point',
  navigate: 'Navigate',
  navigateTo: 'Navigate to {{place}}',
  navigationApp: { waze: 'Waze', google: 'Google Maps', apple: 'Apple Maps' },
  mapA11y: 'Map of the ride route',
} as const;
