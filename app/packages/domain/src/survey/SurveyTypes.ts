/**
 * Survey domain value types — FR-SETTINGS-015..017.
 * Covers the in-app surveys (`ux-experience`, `pmf-sean-ellis`) and the shared question schema.
 * Zero dependencies on node_modules (besides typescript).
 */

export type SurveyCompletionStatus = 'not_started' | 'in_progress' | 'completed';

export type SurveyQuestionType =
  | 'rating_1_7_with_optional_text'
  /** One option out of `choiceOptions`, plus optional text (KC#1058, Sean Ellis PMF). */
  | 'single_choice_with_optional_text';

/** One option of a single-choice question; `key` is what an answer stores. */
export interface SurveyChoiceOption {
  readonly key: string;
  readonly labelHe: string;
}

export interface SurveyListItem {
  readonly slug: string;
  readonly titleHe: string;
  readonly descriptionHe: string | null;
  readonly currentVersion: number;
  readonly completionStatus: SurveyCompletionStatus;
}

export interface SurveyQuestion {
  readonly id: string;
  readonly sortOrder: number;
  readonly questionType: SurveyQuestionType;
  readonly shortLabelHe: string;
  readonly promptHe: string;
  readonly contextHe: string;
  readonly textPlaceholderHe: string;
  readonly ratingAnchorLowHe: string;
  readonly ratingAnchorHighHe: string;
  /** Ordered options of a single-choice question; empty for rating questions. */
  readonly choiceOptions: readonly SurveyChoiceOption[];
}

/** An answer holds a rating (rating question) or a choice key (single-choice question). */
export interface SurveyAnswerDraft {
  readonly questionId: string;
  readonly rating: number | null;
  readonly choiceKey: string | null;
  readonly answerText: string | null;
}

/** True when the answer carries its question's value (a rating or a chosen option). */
export function hasSurveyAnswerValue(
  answer: Pick<SurveyAnswerDraft, 'rating' | 'choiceKey'> | undefined,
): boolean {
  return answer != null && (answer.rating != null || answer.choiceKey != null);
}

export interface SurveyBundle {
  readonly slug: string;
  readonly titleHe: string;
  readonly version: number;
  readonly questions: readonly SurveyQuestion[];
  readonly answers: readonly SurveyAnswerDraft[];
}

export interface SurveyPromptEligibility {
  readonly show: boolean;
  readonly slug: string;
}
