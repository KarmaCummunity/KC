// Hebrew copy for the baseline refusals of the challenge RPCs (supabase/schemas/74_challenges)
// that the older challenge copy in challenges.ts does not cover. Merged into
// `challenges.errors`; keys mirror CHALLENGE_ERROR_CODES in @kc/domain.
export const challengeBaselineErrorsHe = {
  invalid_input: 'חלק מהפרטים אינם תקינים. בדקו את השם, תאריך הסיום והערך ונסו שוב.',
  city_required: 'כדי לפתוח אתגר צריך עיר בפרופיל. הוסיפו עיר בעריכת הפרופיל ונסו שוב.',
  challenge_world_not_configured: 'אי אפשר לפתוח אתגרים כרגע. נסו שוב מאוחר יותר.',
} as const;
