import { PMF_SURVEY_SLUG, summarizePmfSurvey } from '@kc/domain';
import type { PmfSurveyReport, PmfSurveySummary } from '@kc/domain';
import type { ISurveyAdminRepository } from '../ports/ISurveyAdminRepository';

export interface PmfSurveyReportView {
  readonly report: PmfSurveyReport;
  readonly summary: PmfSurveySummary;
}

/** Loads the Sean Ellis PMF counts and derives the score, margin of error and retention (KC#1058). */
export class GetPmfSurveyReportUseCase {
  constructor(private readonly repo: ISurveyAdminRepository) {}

  async execute(slug: string = PMF_SURVEY_SLUG): Promise<PmfSurveyReportView> {
    const report = await this.repo.getPmfReport(slug);
    return { report, summary: summarizePmfSurvey(report) };
  }
}
