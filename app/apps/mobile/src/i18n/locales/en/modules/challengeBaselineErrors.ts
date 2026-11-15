// English copy for the baseline refusals of the challenge RPCs (supabase/schemas/74_challenges)
// that the older challenge copy in challenges.ts does not cover. Merged into
// `challenges.errors`; keys mirror CHALLENGE_ERROR_CODES in @kc/domain.
export const challengeBaselineErrorsEn = {
  invalid_input: 'Some details are not valid. Check the name, the end date and the value, then try again.',
  city_required: 'Opening a challenge needs a city on your profile. Add one in Edit profile, then try again.',
  challenge_world_not_configured: 'Challenges cannot be opened right now. Try again later.',
} as const;
