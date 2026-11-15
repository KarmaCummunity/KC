// D26 rich notifications (migration 0027): the pieces a text may name about its post, and the
// knowledge-booking kinds that had no text. Merged into the `notifications` namespace; the push
// worker renders the same strings (scripts/generate-notification-kinds.mjs reads this module too).
export const notificationsRichHe = {
  // Used when a notification's post has no title to name.
  postTitleFallback: 'הפוסט',
  // Pieces of `{{details}}`, joined after the post title.
  detailsSeats: '{{seats}} מקומות',
  detailsRoute: '{{from}} ← {{to}}',
  knowledgeBookingClaimedTitle: 'מפגש חדש נקבע',
  knowledgeBookingClaimedBody: '{{actorName}} קבע/ה מפגש ({{postTitle}}{{details}}).',
  knowledgeBookingNoShowTitle: 'המפגש לא התקיים',
  knowledgeBookingNoShowBody: 'סומן שהמפגש לא התקיים כמתוכנן ({{postTitle}}). הפרטים בעמוד הפוסט.',
  knowledgeBookingWaitlistPromotedTitle: 'התפנה לך מקום במפגש',
  knowledgeBookingWaitlistPromotedBody: 'עברת מרשימת ההמתנה ({{postTitle}}{{details}}).',
  knowledgeBookingReinstatedTitle: 'ההזמנה למפגש חזרה לתוקף',
  knowledgeBookingReinstatedBody: 'ההזמנה שבוטלה הוחזרה ({{postTitle}}{{details}}).',
} as const;
