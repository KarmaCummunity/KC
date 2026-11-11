// FR-MOD-007/010 + FR-ADMIN-002..007 — moderation strings (TD-35 file-size budget).
export const moderationEn = {
  report: {
    // Placeholder inside the optional note box of every report sheet (post, chat, listing, user).
    noteHint: 'Tell us what happened so we can review it',
    user: {
      title: 'Report user',
      reasonLabel: 'Reason for report',
      noteLabel: 'Note (optional, up to 500 characters)',
      submit: 'Submit report',
      successTitle: 'Report submitted',
      successToast: '✅ Your report was received. Our team will review it.',
      duplicateTitle: 'Already reported',
      duplicateError: 'You already reported this user in the last 24 hours.',
      alreadyModeratedTitle: 'Already handled',
      alreadyModeratedError: 'This user has already been handled by the moderators. Thanks for your help.',
      errorTitle: 'Error',
    },
  },
  reasons: {
    spam: 'Spam',
    offensive: 'Offensive content',
    misleading: 'Misleading',
    illegal: 'Illegal',
    other: 'Other',
  },
  ban: {
    title: 'Ban user',
    reasonLabel: 'Reason for ban',
    reasons: {
      spam: 'Spam',
      harassment: 'Harassment',
      policy_violation: 'Policy violation',
      other: 'Other',
    },
    noteLabel: 'Additional notes',
    submit: 'Ban',
    confirmCopy: 'This action is permanent and cannot be undone. Continue?',
    successToast: 'User banned.',
  },
  suspendedBanner: {
    body: 'Your account is suspended: you can browse, but not post or send messages. You can contact support.',
    contactSupport: 'Contact support',
  },
  bubble: {
    reportReceived: {
      title: 'Report received',
      body: 'Report on {target_type} · {reason} · {count}/3',
    },
    autoRemoved: {
      title: 'Auto-removed',
      body: '{target_type} removed after 3 reports',
    },
    modActionTaken: {
      body: '✅ Handled by admin · {action} · {time}',
    },
    ownerHiddenForReview: {
      body: 'Your post was hidden after repeated reports and is waiting for a team review. We will update you here.',
    },
    ownerAutoRemoved: {
      body: 'Your post was automatically removed following repeated reports. If this is a mistake, you can appeal via the support address.',
    },
    donationLinkReported: {
      title: 'Donation link reported',
      a11yOpen: 'Open link: {name}',
    },
    targetPreview: {
      open: 'Open',
      postLabel: 'Post',
      profileLabel: 'Profile',
      hasImage: '📷 Includes an image',
      reporterNoteLabel: 'Reporter note:',
      evidenceLabel: 'Snapshot from the time of the report',
      chatNote: 'Chat report — the other party is shown',
      a11yOpenPost: 'Open post by {who}',
      a11yOpenProfile: 'Open profile of {who}',
    },
  },
  block: {
    block: 'Block user',
    unblock: 'Unblock user',
    confirmBlockTitle: 'Block this user?',
    confirmBlockBody: "You won't see each other's posts, listings or profile, you can't message each other, and any follows between you are removed. They are not notified.",
    confirmUnblockTitle: 'Unblock this user?',
    confirmUnblockBody: 'You will be able to see each other again. Follows removed by the block are not restored.',
    blockedToast: 'User blocked.',
    unblockedToast: 'User unblocked.',
    // FR-MOD-004 AC1 — the Blocked Users screen (Settings).
    listTitle: 'Blocked users',
    listHint: "People you blocked don't see you and you don't see them. Unblocking restores visibility, not follows.",
    listEmpty: "You haven't blocked anyone.",
    listError: "We couldn't load the list. Please try again.",
    unnamedUser: 'User',
    failed: 'Something went wrong. Please try again.',
  },
  actions: {
    restore: '↩ Restore',
    dismiss: '🗑 Dismiss report',
    confirm: '✓ Confirm removal',
    ban: '🚫 Ban user',
    removePost: '🗑 Remove post',
    deleteMessage: '🗑 Delete message',
    cancel: 'Cancel',
    proceed: 'Continue',
    confirmModal: {
      restore: 'This action will mark the reports on the target as false, which may lead to a sanction against the reporters. Continue?',
      dismiss: 'Mark this report as false. Other reports are unaffected. Continue?',
      confirm: 'Confirm the automatic removal as a definite violation. Continue?',
      ban: 'This action is permanent and cannot be undone. Continue?',
      removePost: 'Remove this post as an admin. Continue?',
      deleteMessage: 'Delete this message permanently. Continue?',
    },
    success: {
      restore: 'Target restored.',
      dismiss: 'Report dismissed.',
      confirm: 'Report confirmed.',
      ban: 'User banned.',
      removePost: 'Post removed.',
      deleteMessage: 'Message deleted.',
    },
    errors: {
      forbidden: 'You do not have permission for this action.',
      invalidRestoreState: 'The target cannot be restored in its current state.',
      networkError: 'Network error. Please try again.',
    },
  },
  supportIssueBubble: {
    title: 'Support request',
    issueRef: 'Request ID:',
    categoryLabel: 'Category:',
  },
} as const;

export const auditEn = {
  title: 'Audit',
  searchPlaceholder: 'Search for a user by name...',
  noResults: 'No results.',
  loading: 'Loading...',
  metadataLabel: 'Metadata',
  rowAction: {
    block_user: 'Block',
    unblock_user: 'Unblock',
    report_target: 'Report',
    auto_remove_target: 'Auto-removal',
    manual_remove_target: 'Manual removal',
    restore_target: 'Restore',
    suspend_user: 'Suspend',
    unsuspend_user: 'Reactivate',
    ban_user: 'Permanent ban',
    false_report_sanction_applied: 'Sanction for false reports',
    dismiss_report: 'Dismiss report',
    confirm_report: 'Confirm report',
    delete_message: 'Delete message',
  },
} as const;

export const accountBlockedEn = {
  supportMail: {
    subject: 'Message from a user — restricted account (Karma Community)',
    body:
      'Hello Karma team,\n\n' +
      'I am reaching out regarding the status of my account in the app.\n\n' +
      'Brief description:\n\n' +
      '————————————\n' +
      '(fill in here)\n',
  },
  banned: {
    title: 'Account permanently banned',
    body: 'Your account was banned following a violation of the community policy.',
    cta: 'Contact us',
  },
  suspendedAdmin: {
    title: 'Account suspended',
    body: 'Moderation has suspended your account pending review.',
    cta: 'Appeal',
  },
  suspendedForFalseReports: {
    title: 'Account temporarily suspended',
    body: 'Your account is suspended until {until} due to 5 false reports in the last 30 days.',
    cta: 'Early appeal',
  },
} as const;
