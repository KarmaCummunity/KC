// KC#1122 / FR-ADMIN-029 — admin match-quality dashboard.
export const adminMatchingEn = {
  title: 'Match quality',
  subtitle: 'Per world, by the first alert sent for each pair',
  forbiddenTitle: 'You do not have permission to view match quality.',
  loading: 'Loading...',
  error: 'Could not load the data. Pull to refresh.',
  empty: 'No match alerts were sent in this period.',
  windows: { d7: '7 days', d30: '30 days', d90: '90 days' },
  metrics: {
    notified: 'Pairs alerted',
    precision: 'Precision (accepts / answers)',
    chat: 'Started a chat',
    completion: 'Handoff completed',
  },
  counts: (accepted: number, responses: number) => `${accepted}/${responses} answers`,
  pairs: (n: number) => `${n} pairs`,
  notTracked: 'Not tracked for this world',
};
