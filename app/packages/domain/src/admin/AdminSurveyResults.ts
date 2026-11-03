/**
 * Admin survey analytics value types — FR-ADMIN-021.
 * Read-only projections consumed by the Admin Portal survey dashboard:
 * aggregate per-question statistics plus per-user answers and free feedback.
 * Zero dependencies on node_modules (besides typescript).
 */

import type { SurveyQuestionType } from '../survey/SurveyTypes';

/** One published survey with response counts (overview list). */
export interface AdminSurveyOverviewItem {
  readonly slug: string;
  readonly titleHe: string;
  readonly descriptionHe: string | null;
  readonly isActive: boolean;
  readonly currentVersion: number;
  readonly questionCount: number;
  readonly respondentCount: number;
  readonly responseTotal: number;
  readonly lastResponseAt: string | null;
}

/**
 * Aggregate statistics for a single question.
 * `distribution[i]` is the number of respondents who chose rating `i + 1`
 * (index 0 → rating 1 … index 6 → rating 7).
 */
export interface AdminSurveyQuestionStat {
  readonly id: string;
  readonly sortOrder: number;
  readonly questionType: SurveyQuestionType;
  readonly shortLabelHe: string;
  readonly promptHe: string;
  readonly ratingAnchorLowHe: string;
  readonly ratingAnchorHighHe: string;
  readonly responseCount: number;
  readonly avgRating: number | null;
  readonly distribution: readonly number[];
  /** Single-choice questions: answers per option, in option order; empty for rating questions. */
  readonly choiceCounts: readonly AdminSurveyChoiceCount[];
}

/** How many respondents chose one option of a single-choice question (KC#1058). */
export interface AdminSurveyChoiceCount {
  readonly key: string;
  readonly labelHe: string;
  readonly count: number;
}

/** A single respondent's answer to one question: a rating or a chosen option key. */
export interface AdminSurveyRespondentAnswer {
  readonly questionId: string;
  readonly rating: number | null;
  readonly choiceKey: string | null;
  readonly answerText: string | null;
}

/** All answers submitted by one user for the survey's current version. */
export interface AdminSurveyRespondent {
  readonly userId: string;
  readonly displayName: string | null;
  readonly submittedAt: string;
  readonly answers: readonly AdminSurveyRespondentAnswer[];
}

/** Full result bundle for one survey: stats + per-user answers. */
export interface AdminSurveyResults {
  readonly slug: string;
  readonly titleHe: string;
  readonly version: number;
  readonly respondentCount: number;
  readonly questions: readonly AdminSurveyQuestionStat[];
  readonly respondents: readonly AdminSurveyRespondent[];
}

/** One free-text feedback entry (FR-SETTINGS-017). */
export interface AdminFeedbackEntry {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly rating: number | null;
  readonly body: string;
  readonly createdAt: string;
}
