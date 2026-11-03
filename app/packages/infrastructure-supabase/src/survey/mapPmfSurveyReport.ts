// mapPmfSurveyReport — `admin_pmf_survey_report` JSON (0458) → PmfSurveyReport (KC#1058).
// Counts only; the score and margin of error are derived in @kc/domain.

import type { PmfSurveyReport } from '@kc/domain';

export interface RawPmfOption {
  key: string;
  label_he: string;
  count: number;
  retention_base: number;
  retained: number;
}

export interface RawPmfSurveyReport {
  slug: string;
  title_he: string;
  version: number;
  prompt_he: string;
  min_active_days_14d: number;
  respondents_total: number;
  respondents_qualified: number;
  /** `json_agg` returns null for a question without options; the table constraint forbids it. */
  options: RawPmfOption[] | null;
}

export function mapPmfSurveyReport(raw: RawPmfSurveyReport): PmfSurveyReport {
  return {
    slug: raw.slug,
    titleHe: raw.title_he,
    version: raw.version,
    promptHe: raw.prompt_he,
    minActiveDays14d: raw.min_active_days_14d,
    respondentsTotal: raw.respondents_total,
    respondentsQualified: raw.respondents_qualified,
    options: (raw.options ?? []).map((o) => ({
      key: o.key,
      labelHe: o.label_he,
      count: o.count,
      retentionBase: o.retention_base,
      retained: o.retained,
    })),
  };
}
