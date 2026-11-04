// FR-STATS-007 — English strings for the /admin/stats platform statistics screen.
export const adminStatsEn = {
  title: 'Platform statistics',
  subtitle: 'Each world’s flow: what was published in the window, how much was booked, confirmed, handed over or cancelled, and how long it took.',
  loading: 'Loading...',
  forbidden: "You don't have permission for this screen.",
  error: "We couldn't load the data. Please try again.",
  empty: 'Nothing was published in this window.',
  windows: { d7: '7 days', d30: '30 days', d90: '90 days' },
  directions: { give: 'Offers', request: 'Requests' },
  totals: 'Givings closed in the window',
  metrics: {
    published: 'Published',
    booked: 'Booked',
    confirmed: 'Confirmed',
    completed: 'Handed over',
    cancelled: 'Cancelled',
    closed: 'Closed',
    hoursToBooking: 'Hours to booking (median)',
    hoursToCompletion: 'Hours to handover (median)',
  },
  notTracked: 'Not tracked in this world',
} as const;
