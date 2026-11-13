// D26 rich notifications (migration 0027): the pieces a text may name about its post, and the
// knowledge-booking kinds that had no text. Merged into the `notifications` namespace.
export const notificationsRichEn = {
  // Used when a notification's post has no title to name.
  postTitleFallback: 'the post',
  // Pieces of `{{details}}`, joined after the post title.
  detailsSeats: '{{seats}} seats',
  detailsRoute: '{{from}} → {{to}}',
  knowledgeBookingClaimedTitle: 'New session booked',
  knowledgeBookingClaimedBody: '{{actorName}} booked a session ({{postTitle}}{{details}}).',
  knowledgeBookingNoShowTitle: 'The session did not take place',
  knowledgeBookingNoShowBody: 'The session was marked as not held ({{postTitle}}). Details are on the post page.',
  knowledgeBookingWaitlistPromotedTitle: 'A place opened up for you',
  knowledgeBookingWaitlistPromotedBody: 'You moved off the waiting list ({{postTitle}}{{details}}).',
  knowledgeBookingReinstatedTitle: 'Your session booking is back',
  knowledgeBookingReinstatedBody: 'The cancelled booking was restored ({{postTitle}}{{details}}).',
} as const;
