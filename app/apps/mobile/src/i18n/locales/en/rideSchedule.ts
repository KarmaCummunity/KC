// English — ride quick publish: departure, estimated end and seats (spec 05 §5.3 step 1, D75, S46).
export const rideSchedule = {
  departure: 'Departure',
  leaveNow: 'Leave now',
  leaveNowHint: 'The ride leaves a few minutes after you publish.',
  arrival: 'Estimated end',
  arrivalPlaceholder: 'Suggested from the route',
  arrivalHint: 'Suggested from the distance — you can change it.',
  shortcut: {
    in30: 'In 30 min',
    in60: 'In 1 hour',
    tomorrow0700: 'Tomorrow 07:00',
  },
  seats: 'Free seats',
  fewerSeats: 'Fewer seats',
  moreSeats: 'More seats',
  publishAgain: 'Publish this ride again',
} as const;

// The shared date + time field (sheet actions).
export const dateTimeField = {
  done: 'Done',
  cancel: 'Cancel',
} as const;

// The rides feed on the hub (D75): offers and requests by departure, grouped by day.
export const rideFeed = {
  group: { today: 'Today', tomorrow: 'Tomorrow', later: 'Later' },
  seatsLeft: 'Free seats: {{count}}',
  full: 'No free seats',
  passengers: 'Passengers: {{count}}',
  meetingPoints: 'Pickup points: {{count}}',
  empty: 'No upcoming rides right now. You can publish a ride or a request.',
  error: "We couldn't load the rides. Pull down to try again.",
  // #1626 — empty-feed calls to action (neutral phrasing, spec 17 §7.2).
  publishCta: 'Post a ride',
  clearFilters: 'Clear filters',
  // #1626 — the route search is a collapsed filter on top of the rides feed.
  routeFilterTitle: 'Filter by route',
  routeFilterActive: '{{from}} → {{to}}',
  routeFilterClear: 'Clear route',
} as const;

// Saved routes (D74): follow a route and hear about new rides on it.
export const rideRoutes = {
  follow: 'Notify me about rides on this route',
  wantsLabel: 'Notify me about',
  wants: { offers: 'Ride offers', requests: 'Ride requests' },
  daysLabel: 'Which days? (none — every day)',
  weekday: { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' },
  hoursLabel: 'Which hours?',
  anyHour: 'Any hour',
  window: { morning: 'Morning (06–10)', midday: 'Midday (10–15)', evening: 'Evening (15–21)' },
  save: 'Save route',
  saved: "Route saved. We'll let you know when a matching ride is published.",
  saveError: "We couldn't save the route. Please try again.",
  mine: 'My routes',
  remove: 'Remove',
  removeError: "We couldn't remove the route. Please try again.",
} as const;

// Ride safety (D70): the emergency call during a ride and the no-profit cost cap.
export const rideSafety = {
  emergency: 'Emergency call',
  emergencyConfirm: 'Send an emergency call to everyone on the ride and to the KC team?',
  emergencySend: 'Yes, send now',
  emergencyCancel: 'Cancel',
  emergencySent: 'Your emergency call was sent. In immediate danger, call 100.',
  costCapHint: 'Cost sharing up to ₪{{cap}} — no profit.',
} as const;

// Recurring rides (FR-RIDE-046): the switch in the create form, the labels on cards and
// the "my recurring rides" screen.
export const rideSeries = {
  toggle: 'Recurring ride',
  daysLabel: 'Which days?',
  endsOn: 'End date',
  noEnd: 'No end date',
  clearEnd: 'Remove the end date',
  publishHint: 'The ride is published on every picked day at {{time}}, a month ahead.',
  departureHint: 'The departure time you pick above becomes the recurring time.',
  every: 'Every {{days}} at {{time}}',
  everyDay: 'Every day at {{time}}',
  until: 'Until {{date}}',
  moreDates: '{{count}} more dates',
  otherDates: 'Other dates',
  mine: 'My recurring rides',
  manage: 'Manage the recurring ride',
  empty: 'No recurring ride yet. In the publish form, turn on "Recurring ride" and pick days.',
  error: "We couldn't load your recurring rides. Please try again.",
  status: { paused: 'Paused' },
  pause: 'Pause',
  resume: 'Resume',
  reschedule: 'Reschedule',
  cancel: 'Cancel the recurring ride',
  cancelConfirm: 'Cancel the recurring ride? Every upcoming ride is cancelled, booked ones too, and the passengers are told.',
  cancelYes: 'Yes, cancel',
  keep: 'Keep',
  time: 'Departure time',
  save: 'Save',
  saved: 'Schedule updated. Upcoming rides nobody booked were published again.',
  errors: {
    weekdaysRequired: 'Pick at least one day for the recurring ride.',
    generic: 'That did not work. Please try again.',
  },
} as const;
