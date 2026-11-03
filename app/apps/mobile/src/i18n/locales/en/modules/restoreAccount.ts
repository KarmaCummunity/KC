// FR-AUTH-016 — restore a deleted account within its 30-day grace period.
export const restoreAccountEn = {
  title: 'Your account is deactivated',
  body: 'You deleted your account. You can restore it completely until {{date}}. After that date everything is deleted for good.',
  restore: 'Restore my account',
  restoring: 'Restoring…',
  signOut: 'Sign out',
  errors: {
    generic: 'Restoring failed. Check your connection and try again.',
    expired: 'The restore period has ended and the account was deleted.',
    notPending: 'The account is already active.',
  },
} as const;
