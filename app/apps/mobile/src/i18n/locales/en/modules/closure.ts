// FR-CLOSURE-001..005 strings (closure sheet, recipient picker, explainer,
// reopen confirm, owner actions bar). Extracted to its own module to keep
// `index.ts` under the 200-LOC cap (TD-156 slice 6).
export const closureEn = {
  // FR-CLOSURE-001 — owner CTAs on PostDetail (OwnerActionsBar)
  detailCloseSuccessToast: 'The post was closed successfully.',
  detailReopenSuccessToast: 'The post was reopened successfully.',
  markGiveCta: 'Mark as delivered ✓',
  markAnimalsCta: 'Mark as handed over ✓',
  markHousingCta: 'End the stay',
  markRidesCta: 'Assign a passenger',
  assignUserCta: 'Assign to a user',
  assignSuccessToast: 'That member is assigned.',
  markRequestCta: 'Mark as received ✓',
  /** Shared CTA copy — owner reopen + recipient un-mark (FR-CLOSURE-005 / FR-CLOSURE-007). */
  itemNotDeliveredCta: 'The item wasn\'t delivered after all',
  itemNotDeliveredA11y: 'The item wasn\'t delivered after all',
  reopenCta: '📤 Reopen',
  reopenA11y: 'Reopen',

  // FR-CLOSURE-002 — Step 1 confirmation (ClosureSheet > Step1)
  step1GiveTitle: '🤝  Was the item really delivered?',
  step1RequestTitle: '🤝  Did you really receive the item?',
  step1GiveBody:
    'Only mark this after the physical handover — not after coordinating in chat. If the item hasn\'t reached the recipient yet, don\'t mark it.',
  step1RequestBody:
    'Only mark this after the item has reached you — not after coordinating in chat. If you haven\'t received the item yet, don\'t mark it.',
  step1GiveCta: 'Yes, delivered ✓',
  step1RequestCta: 'Yes, received ✓',

  // FR-CLOSURE-003 — Step 2 recipient picker (ClosureStep2)
  step1FoodTitle: '🤝  Was the food really handed over?',
  step1FoodBody: 'Mark this only after the food arrived, not after coordinating in chat.',
  step1FoodCta: 'Yes, handed over ✓',
  step1AnimalsTitle: '🤝  Was the animal really handed over?',
  step1AnimalsBody: 'Mark this only after the handover, not after coordinating in chat.',
  step1AnimalsCta: 'Yes, handed over ✓',
  step1RidesTitle: '🤝  Assign this passenger?',
  step1RidesBody: 'Assign a passenger to hold a seat, or after they have already ridden with you.',
  step1RidesCta: 'Yes, assign',
  step1HousingTitle: '🤝  Confirm this stay?',
  step1HousingBody: 'Assign a guest to hold a place, or after the stay has happened.',
  step1HousingCta: 'Yes, confirm',
  step1KnowledgeTitle: '🤝  Did the session happen?',
  step1KnowledgeBody: 'Mark this only after the session, not after coordinating in chat.',
  step1KnowledgeCta: 'Yes, it happened ✓',
  step2GiveTitle: '🎁  Who did you give the item to?',
  step2RequestTitle: '🎁  Who did you receive the item from?',
  step2FoodTitle: '🎁  Who received the food?',
  step2AnimalsTitle: '🎁  Who received the animal?',
  step2RidesTitle: '🎁  Who should get a seat?',
  step2HousingTitle: '🎁  Who is the guest?',
  step2KnowledgeTitle: '🎁  Who was the session with?',
  step2CloseWithoutMarking: 'Close without marking',
  step2MarkAndClose: 'Mark and close ✓',
  step2RidesPrimary: 'Assign passenger',
  step2HousingPrimary: 'Assign guest',
  step2KnowledgePrimary: 'Mark the session ✓',
  step2NoSearchResults: 'No user found by that name.',

  // ClosureRecipientPanes (sub-component of Step 2)
  pickModeChats: 'From my chats',
  pickModeSearch: 'General search',
  searchPlaceholder: 'Search by name or handle',
  chatsEmpty:
    'You haven\'t chatted with anyone yet. Go to "General search" to pick from the full list, or tap "Close without marking".',
  chatsEmptyNamedOnly:
    'You haven\'t chatted with anyone yet. Use "General search" to pick someone.',

  // FR-CLOSURE-004 — educational explainer (ClosureExplainerSheet)
  explainerFoodTitle: '✨  Thanks for handing it over!',
  explainerFoodBody: 'The food is marked as received by the person you chose.',
  explainerAnimalsTitle: '✨  Thanks for the handover!',
  explainerAnimalsBody: 'The animal is marked as received by the person you chose.',
  explainerRidesTitle: '✨  Passenger assigned',
  explainerRidesBody: 'Their seat is held. The ride stays open for others until it is full or the trip is finished.',
  explainerHousingTitle: '✨  Guest assigned',
  explainerHousingBody: 'Their stay is held. The listing stays open for other guests.',
  explainerKnowledgeTitle: '✨  Session marked',
  explainerKnowledgeBody: 'The session is recorded with the person you chose.',
  explainerGiveTitle: '✨  Thanks for giving!',
  explainerRequestTitle: '✨  Thanks for the update!',
  explainerLead: 'Here\'s how it works:',
  explainerGiveMarkedBullet:
    '• Posts marked with a recipient are kept forever and appear in your stats and the recipient\'s.',
  explainerRequestMarkedBullet:
    '• Posts marked with a giver are kept forever and appear in your stats and the giver\'s.',
  explainerMiddleBullet:
    '• Posts closed without marking are kept for 7 days in case of a mistake, then deleted automatically.',
  explainerGiveCounterBullet: '• Either way — your "Items I gave" goes up by 1.',
  explainerRequestCounterBullet: '• Either way — your "Items I received" goes up by 1.',
  explainerDontShowAgain: 'Don\'t show again',

  // FR-CLOSURE-001 — error pane (ClosureErrorPane)
  errorTitle: '⚠️  Something went wrong',
  errorDefault: 'We couldn\'t start the closing process. Please try again in a moment.',

  // FR-CLOSURE-005 — reopen confirm (ReopenConfirmModal)
  itemNotDeliveredModalTitle: 'The item wasn\'t delivered after all?',
  reopenTitle: '📤  Reopen the post?',
  reopenBodyClosedDelivered: 'The post will be active in the feed again.',
  reopenBodyDeletedNoRecipient: 'The post will be active in the feed again and won\'t be deleted.',
  reopenBulletMarkedRemoved: '• The mark for {{markedSide}} will be removed.',
  reopenBulletMarkedCounter: '• Their "{{counter}}" will go down by 1 (no notification).',
  reopenBulletOwnerCounter: '• Your "{{counter}}" will go down by 1.',
  reopenConfirmCta: 'Reopen',
  markedSideGive: 'the recipient',
  markedSideRequest: 'the giver',
  counterDonated: 'Items I gave',
  counterReceived: 'Items I received',

  // RecipientCallout (closed_delivered post-detail row)
  calloutGiveLabel: 'Delivered to',
  calloutRequestLabel: 'Given by',
  calloutGiveSublabel: 'The item was delivered',
  calloutRequestSublabel: 'The request was answered',

  // RecipientUnmarkBar (FR-CLOSURE-007)
  unmarkSelfCta: 'The item wasn\'t delivered after all',
  unmarkSelfA11y: 'The item wasn\'t delivered after all',
  unmarkConfirmTitle: 'The item wasn\'t delivered after all?',
  unmarkConfirmBody:
    'You won\'t get credit for this item, and the post owner will be notified. The post will be kept for 7 days before deletion.',
  unmarkConfirmCta: 'Remove',
  unmarkErrorBody: 'We couldn\'t remove the mark. Please try again.',
} as const;
