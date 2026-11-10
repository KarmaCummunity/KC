import type {
  ChallengeCadence,
  ChallengeDifficulty,
  ChallengeDraft,
  ChallengeGoalDirection,
  ChallengeMeasurement,
  ChallengeScope,
} from '@kc/domain';

/** Raw text/choice state of the "open a challenge" form. */
export interface ChallengeFormState {
  readonly title: string;
  readonly description: string;
  readonly scope: ChallengeScope;
  readonly measurement: ChallengeMeasurement;
  readonly cadence: ChallengeCadence;
  readonly goalValue: string;
  readonly goalDirection: ChallengeGoalDirection;
  readonly difficulty: ChallengeDifficulty | null;
  readonly topicLabel: string;
  readonly targetCycles: string;
}

export const INITIAL_CHALLENGE_FORM: ChallengeFormState = {
  title: '',
  description: '',
  scope: 'community',
  measurement: 'yes_no',
  cadence: 'daily',
  goalValue: '',
  goalDirection: 'at_least',
  difficulty: null,
  topicLabel: '',
  targetCycles: '',
};

/**
 * Parses a typed number ("12", "2.5", "2,5"). Empty input is "not set" (null); anything that is
 * not a number becomes NaN so the domain validator rejects it instead of silently dropping it.
 */
export function parseOptionalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return Number(trimmed.replace(',', '.'));
}

/** Builds the domain draft from the form; the domain validator is the judge of its content. */
export function challengeDraftFromForm(form: ChallengeFormState): ChallengeDraft {
  // A yes/no challenge has no numeric goal, so a goal typed before switching measurement is dropped.
  const goalValue = form.measurement === 'yes_no' ? null : parseOptionalNumber(form.goalValue);
  return {
    title: form.title,
    description: form.description.trim() || null,
    scope: form.scope,
    measurement: form.measurement,
    cadence: form.cadence,
    goalValue,
    goalDirection: goalValue === null ? null : form.goalDirection,
    difficulty: form.difficulty,
    topicLabel: form.topicLabel.trim() || null,
    endsAt: null,
    targetCycles: parseOptionalNumber(form.targetCycles),
  };
}
