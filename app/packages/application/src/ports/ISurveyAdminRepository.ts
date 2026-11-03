import type {
  AdminSurveyOverviewItem,
  AdminSurveyResults,
  AdminFeedbackEntry,
  PmfSurveyReport,
} from '@kc/domain';

/**
 * Read-only port for the Admin Portal survey dashboard (FR-ADMIN-021).
 * Backed by security-definer RPCs gated to super_admin / moderator.
 */
export interface ISurveyAdminRepository {
  /** Lists published surveys with response/respondent counts. */
  listOverview(): Promise<AdminSurveyOverviewItem[]>;

  /** Per-question statistics + per-user answers for a survey's current version. */
  getResults(slug: string): Promise<AdminSurveyResults>;

  /**
   * Sean Ellis PMF counts per option among qualified respondents, with the 7-day
   * retention cross-check (KC#1058). Raw counts; the use case derives the rates.
   */
  getPmfReport(slug: string): Promise<PmfSurveyReport>;

  /** Paginated free-text feedback with submitter display name. */
  listFeedback(limit: number, offset: number): Promise<AdminFeedbackEntry[]>;
}
