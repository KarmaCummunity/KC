/**
 * Sean Ellis product/market-fit survey — KC#1058, FR-ADMIN-021.
 *
 * The server (`admin_pmf_survey_report`) returns raw counts among qualified respondents
 * (active on ≥ N days in the 14 days before answering). This module derives the headline
 * share of "very disappointed", its 95% margin of error and the per-option retention rate.
 * Zero dependencies on node_modules.
 */

/** Slug of the seeded Sean Ellis survey (migration 0457). */
export const PMF_SURVEY_SLUG = 'pmf-sean-ellis' as const;

/** The option whose share is the PMF score. */
export const PMF_VERY_DISAPPOINTED_KEY = 'very_disappointed' as const;

/** Sean Ellis benchmark: ≥ 40% "very disappointed" signals product/market fit. */
export const PMF_BENCHMARK_SHARE = 0.4;

/** Below this many qualified answers the score is too noisy to act on (Sean Ellis guidance). */
export const PMF_MIN_RELIABLE_SAMPLE = 40;

/** Two-sided 95% normal quantile. */
const Z_95 = 1.96;

/** Counts for one answer option among qualified respondents. */
export interface PmfOptionCounts {
  readonly key: string;
  readonly labelHe: string;
  /** Qualified respondents who chose this option. */
  readonly count: number;
  /** Of them, those who answered ≥ 7 days ago (retention is measurable). */
  readonly retentionBase: number;
  /** Of `retentionBase`, those active again on a day ≥ 7 days after answering. */
  readonly retained: number;
}

/** Raw report from the server. */
export interface PmfSurveyReport {
  readonly slug: string;
  readonly titleHe: string;
  readonly version: number;
  readonly promptHe: string;
  /** Activity threshold a respondent had to meet to count (`min_active_days_14d`). */
  readonly minActiveDays14d: number;
  /** Everyone who answered the question, qualified or not. */
  readonly respondentsTotal: number;
  /** Respondents who met the activity threshold: the sample size n. */
  readonly respondentsQualified: number;
  readonly options: readonly PmfOptionCounts[];
}

export interface PmfOptionSummary extends PmfOptionCounts {
  /** count / n, or null when n = 0. */
  readonly share: number | null;
  /** retained / retentionBase, or null when nobody is measurable yet. */
  readonly retentionRate: number | null;
}

export interface PmfSurveySummary {
  readonly sampleSize: number;
  /** Share of "very disappointed" among qualified respondents, or null when n = 0. */
  readonly veryDisappointedShare: number | null;
  /** Half-width of the 95% Wald interval around the share, or null when n = 0. */
  readonly marginOfError95: number | null;
  /** Share ≥ 40%, or null when n = 0. */
  readonly meetsBenchmark: boolean | null;
  /** n ≥ PMF_MIN_RELIABLE_SAMPLE. */
  readonly isReliableSample: boolean;
  readonly options: readonly PmfOptionSummary[];
}

/** Ratio or null for an empty denominator (a missing rate is never shown as 0%). */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** 1.96 · √(p(1−p)/n): the 95% margin of error of a proportion. */
export function marginOfError95(share: number, sampleSize: number): number {
  return Z_95 * Math.sqrt((share * (1 - share)) / sampleSize);
}

export function summarizePmfSurvey(report: PmfSurveyReport): PmfSurveySummary {
  const n = report.respondentsQualified;
  const options = report.options.map((option) => ({
    ...option,
    share: ratio(option.count, n),
    retentionRate: ratio(option.retained, option.retentionBase),
  }));
  const veryCount = report.options.find((o) => o.key === PMF_VERY_DISAPPOINTED_KEY)?.count ?? 0;
  const share = ratio(veryCount, n);

  return {
    sampleSize: n,
    veryDisappointedShare: share,
    marginOfError95: share === null ? null : marginOfError95(share, n),
    meetsBenchmark: share === null ? null : share >= PMF_BENCHMARK_SHARE,
    isReliableSample: n >= PMF_MIN_RELIABLE_SAMPLE,
    options,
  };
}
