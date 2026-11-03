// D9 — English strings for the /admin/donation-links review screen.
export const adminDonationLinksEn = {
  title: 'Donation link approvals',
  hint: 'A suggested link is shown to everyone only once approved. Editing an approved link brings it back here.',
  forbidden: "You don't have permission for this screen.",
  loading: 'Loading...',
  empty: 'No links in this state.',
  loadError: "We couldn't load the list. Please try again.",
  filters: { pending: 'Pending', approved: 'Approved', rejected: 'Not approved' },
  submittedBy: 'Suggested by',
  unknownSubmitter: 'User',
  notePlaceholder: 'Reason for rejecting (optional)',
  approve: 'Approve',
  reject: 'Reject',
  actionFailed: 'That didn’t work. The link may already have been handled.',
} as const;
