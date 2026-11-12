// Labels of the baseline karma_ledger event types (supabase/schemas/72_karma, FR-KARMA-007).
// Merged into `karma.reason` next to modules/karma.ts.
export const karmaEventsHe = {
  item_value_bonus: 'בונוס על שווי הפריט',
  challenge_opened: 'פתיחת אתגר',
  challenge_report: 'דיווח באתגר',
  challenge_completed: 'השלמת אתגר',
  donation: 'תרומה לקהילה',
  standing_order_month: 'חודש של הוראת קבע',
  reversal: 'ביטול נקודות',
} as const;
