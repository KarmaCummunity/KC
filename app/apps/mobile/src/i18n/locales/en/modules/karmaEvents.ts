// Labels of the baseline karma_ledger event types (supabase/schemas/72_karma, FR-KARMA-007).
// Merged into `karma.reason` next to modules/karma.ts.
export const karmaEventsEn = {
  item_value_bonus: 'Item value bonus',
  challenge_opened: 'Opened a challenge',
  challenge_report: 'Challenge report',
  challenge_completed: 'Completed a challenge',
  donation: 'Donation to the community',
  standing_order_month: 'Monthly standing order',
  reversal: 'Points taken back',
} as const;
