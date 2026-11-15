// English copy of the staff support inbox (FR-CHAT-007, FR-MOD-002) and the review queue
// (FR-MOD-008), restored at the baseline. Merged into `admin` by the locale index.
export const adminStaffToolsEn = {
  nav: {
    support:     'Support inbox',
    reviewQueue: 'Review queue',
  },
  supportInbox: {
    title:          'Support inbox',
    subtitle:       'Requests from community members, newest first. Open a conversation to answer.',
    loading:        'Loading requests…',
    forbiddenTitle: 'You do not have access to the support inbox',
    emptyTitle:     'No requests',
    emptyHint:      'When a member contacts support, the conversation appears here.',
    unnamedMember:  'Deleted account',
    joined:         'Yours',
    lastMessage:    (when: string) => `Last message: ${when}`,
    openCta:        'Open conversation',
    openFailed:     'We could not open the conversation. Try again.',
  },
  reviewQueue: {
    title:          'Review queue',
    subtitle:       'Items waiting for the team to review, oldest first.',
    loading:        'Loading the queue…',
    forbiddenTitle: 'You do not have access to the review queue',
    emptyTitle:     'The queue is empty',
    emptyHint:      'Every item has been handled.',
    reasons: {
      report_threshold:  'Reached the report threshold',
      excessive_reopens: 'Reopened many times',
      forbidden_keyword: 'Forbidden keyword',
      manual_flag:       'Flagged by hand',
      operator_case:     'Case to handle',
    },
    targets: {
      post:    'Post',
      user:    'Member',
      comment: 'Comment',
      chat:    'Chat',
    },
    openedAt:    (when: string) => `Opened: ${when}`,
    assignedToMe: 'Yours',
    assigned:     'Taken',
    takeCta:      'Take it',
    resolveCta:   'Mark handled',
    openCta:      'Open',
    actionFailed: 'That did not work. The item may already be handled.',
  },
};
