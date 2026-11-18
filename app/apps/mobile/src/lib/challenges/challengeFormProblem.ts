// Mapped to spec: docs/spec/10_challenges.md / FR-RESP-006 AC29 — runs the domain's own challenge
// rules on the form before anything is sent, and names the field a refusal belongs to, so the
// message shows under that field and the form jumps there.
import { ChallengeError, validateChallengeDraft, type ChallengeErrorCode } from '@kc/domain';
import { challengeDraftFromForm, type ChallengeFormState } from './challengeDraftFromForm';

/** The form fields a validation refusal can point at. */
export type ChallengeFormField = 'title' | 'description' | 'goalValue' | 'goalDirection' | 'topicLabel' | 'targetCycles';

const FIELD_BY_CODE: Partial<Record<ChallengeErrorCode, ChallengeFormField>> = {
  title_too_short: 'title',
  title_too_long: 'title',
  description_too_long: 'description',
  topic_too_long: 'topicLabel',
  goal_not_allowed_for_yes_no: 'goalValue',
  goal_value_invalid: 'goalValue',
  goal_direction_required: 'goalDirection',
  goal_direction_without_goal: 'goalDirection',
  target_cycles_invalid: 'targetCycles',
};

export interface ChallengeFormProblem {
  readonly code: ChallengeErrorCode;
  /** The field the refusal is about; null for a choice the form itself controls (shown at the end). */
  readonly field: ChallengeFormField | null;
}

/** The first rule the form breaks, or null when the draft is valid. */
export function challengeFormProblem(form: ChallengeFormState): ChallengeFormProblem | null {
  try {
    validateChallengeDraft(challengeDraftFromForm(form));
    return null;
  } catch (error) {
    if (!(error instanceof ChallengeError)) throw error;
    return { code: error.code, field: FIELD_BY_CODE[error.code] ?? null };
  }
}
