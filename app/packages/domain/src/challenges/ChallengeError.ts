import { DomainError } from '../errors';

/** Stable machine-readable codes; the UI maps each one to a localized message. */
export const CHALLENGE_ERROR_CODES = [
  'title_too_short',
  'title_too_long',
  'description_too_long',
  'topic_too_long',
  'invalid_scope',
  'invalid_measurement',
  'invalid_cadence',
  'invalid_difficulty',
  'goal_not_allowed_for_yes_no',
  'goal_value_invalid',
  'goal_direction_required',
  'goal_direction_without_goal',
  'target_cycles_invalid',
  'ends_at_invalid',
  'value_invalid',
  'yes_no_value_invalid',
  'note_too_long',
  'report_date_invalid',
  // Server-side outcomes surfaced by the RPCs (supabase/schemas/74_challenges).
  'auth_required',
  'invalid_input',
  'city_required',
  'challenge_world_not_configured',
  'challenge_not_found',
  'challenge_not_active',
  'challenge_ended',
  'not_participant',
  'already_joined',
  'creator_cannot_leave',
  'not_challenge_creator',
  'report_date_out_of_window',
] as const;

export type ChallengeErrorCode = (typeof CHALLENGE_ERROR_CODES)[number];

export class ChallengeError extends DomainError {
  readonly code: ChallengeErrorCode;

  constructor(code: ChallengeErrorCode, message: string = code) {
    super(message, { code });
    this.code = code;
  }
}
