import { ChallengeError } from './ChallengeError';
import { isValidIsoDate } from './challengeCycles';
import {
  CHALLENGE_CADENCES,
  CHALLENGE_DESCRIPTION_MAX_LENGTH,
  CHALLENGE_DIFFICULTIES,
  CHALLENGE_GOAL_DIRECTIONS,
  CHALLENGE_MEASUREMENTS,
  CHALLENGE_NOTE_MAX_LENGTH,
  CHALLENGE_SCOPES,
  CHALLENGE_TARGET_CYCLES_MAX,
  CHALLENGE_TITLE_MAX_LENGTH,
  CHALLENGE_TITLE_MIN_LENGTH,
  CHALLENGE_TOPIC_MAX_LENGTH,
  CHALLENGE_VALUE_MAX,
  type ChallengeDraft,
  type ChallengeProgressInput,
} from './ChallengeTypes';

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isFiniteNumberInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function assertTextFields(draft: ChallengeDraft): void {
  const titleLength = draft.title.trim().length;
  if (titleLength < CHALLENGE_TITLE_MIN_LENGTH) throw new ChallengeError('title_too_short');
  if (titleLength > CHALLENGE_TITLE_MAX_LENGTH) throw new ChallengeError('title_too_long');
  if ((draft.description?.length ?? 0) > CHALLENGE_DESCRIPTION_MAX_LENGTH) {
    throw new ChallengeError('description_too_long');
  }
  if ((draft.topicLabel?.length ?? 0) > CHALLENGE_TOPIC_MAX_LENGTH) {
    throw new ChallengeError('topic_too_long');
  }
}

function assertEnums(draft: ChallengeDraft): void {
  if (!isOneOf(CHALLENGE_SCOPES, draft.scope)) throw new ChallengeError('invalid_scope');
  if (!isOneOf(CHALLENGE_MEASUREMENTS, draft.measurement)) {
    throw new ChallengeError('invalid_measurement');
  }
  if (!isOneOf(CHALLENGE_CADENCES, draft.cadence)) throw new ChallengeError('invalid_cadence');
  if (draft.difficulty !== null && !isOneOf(CHALLENGE_DIFFICULTIES, draft.difficulty)) {
    throw new ChallengeError('invalid_difficulty');
  }
}

/** A goal is a value plus a direction, both or neither; yes/no challenges have none. */
function assertGoal(draft: ChallengeDraft): void {
  const { measurement, goalValue, goalDirection } = draft;
  if (measurement === 'yes_no') {
    if (goalValue !== null || goalDirection !== null) {
      throw new ChallengeError('goal_not_allowed_for_yes_no');
    }
    return;
  }
  if (goalValue === null) {
    if (goalDirection !== null) throw new ChallengeError('goal_direction_without_goal');
    return;
  }
  if (!isFiniteNumberInRange(goalValue, 0, CHALLENGE_VALUE_MAX)) {
    throw new ChallengeError('goal_value_invalid');
  }
  if (!isOneOf(CHALLENGE_GOAL_DIRECTIONS, goalDirection)) {
    throw new ChallengeError('goal_direction_required');
  }
  // "At least 0" is always true, so it cannot be a goal.
  if (goalDirection === 'at_least' && goalValue <= 0) throw new ChallengeError('goal_value_invalid');
}

function assertSchedule(draft: ChallengeDraft): void {
  const { targetCycles, endsAt } = draft;
  if (targetCycles !== null) {
    const valid = Number.isInteger(targetCycles) && targetCycles >= 1 && targetCycles <= CHALLENGE_TARGET_CYCLES_MAX;
    if (!valid) throw new ChallengeError('target_cycles_invalid');
  }
  if (endsAt !== null && Number.isNaN(Date.parse(endsAt))) throw new ChallengeError('ends_at_invalid');
}

/** Throws a `ChallengeError` for the first broken rule; the database re-checks the same rules. */
export function validateChallengeDraft(draft: ChallengeDraft): void {
  assertTextFields(draft);
  assertEnums(draft);
  assertGoal(draft);
  assertSchedule(draft);
}

/**
 * Throws a `ChallengeError` for a malformed progress report. Whether the date is inside the
 * late-logging window depends on the server's Israel date, so only the format is checked here.
 */
export function validateChallengeProgress(input: ChallengeProgressInput): void {
  if (!isFiniteNumberInRange(input.value, 0, CHALLENGE_VALUE_MAX)) {
    throw new ChallengeError('value_invalid');
  }
  if (input.measurement === 'yes_no' && input.value !== 0 && input.value !== 1) {
    throw new ChallengeError('yes_no_value_invalid');
  }
  if ((input.note?.length ?? 0) > CHALLENGE_NOTE_MAX_LENGTH) throw new ChallengeError('note_too_long');
  if (input.reportDate !== null && !isValidIsoDate(input.reportDate)) {
    throw new ChallengeError('report_date_invalid');
  }
}
