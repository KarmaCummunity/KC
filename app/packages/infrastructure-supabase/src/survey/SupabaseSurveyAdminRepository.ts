// SupabaseSurveyAdminRepository — adapter for ISurveyAdminRepository (FR-ADMIN-021) on the
// baseline staff reads of supabase/schemas/90_research (040_user_feedback, 050_survey_reports).
// Maps their snake_case JSON to domain types. Zero business logic.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISurveyAdminRepository } from '@kc/application';
import {
  BackendUnavailableError,
  SurveyError,
  type AdminSurveyOverviewItem,
  type AdminSurveyResults,
  type AdminSurveyQuestionStat,
  type AdminSurveyRespondent,
  type AdminFeedbackEntry,
  type PmfSurveyReport,
  type SurveyQuestionType,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';
import { refusalReason } from '../admin/refusalReason';
import { mapPmfSurveyReport, type RawPmfSurveyReport } from './mapPmfSurveyReport';

// ---------------------------------------------------------------------------
// Raw JSON shapes (snake_case from Postgres)
// ---------------------------------------------------------------------------

interface RawOverview {
  slug: string;
  title_he: string;
  description_he: string | null;
  is_active: boolean;
  current_version: number;
  question_count: number;
  respondent_count: number;
  response_total: number;
  last_response_at: string | null;
}

interface RawQuestionStat {
  id: string;
  sort_order: number;
  question_type: SurveyQuestionType;
  short_label_he: string;
  prompt_he: string;
  rating_anchor_low_he: string;
  rating_anchor_high_he: string;
  response_count: number;
  avg_rating: number | string | null;
  distribution: number[];
  /** `[]` for rating questions (0458). */
  choice_counts: { key: string; label_he: string; count: number }[] | null;
}

interface RawRespondent {
  user_id: string;
  display_name: string | null;
  submitted_at: string;
  answers: {
    question_id: string;
    rating: number | null;
    choice_key: string | null;
    answer_text: string | null;
  }[];
}

interface RawResults {
  slug: string;
  title_he: string;
  version: number;
  respondent_count: number;
  questions: RawQuestionStat[];
  respondents: RawRespondent[];
}

/** Generated RETURNS TABLE columns are non-null; `rating` and `display_name` may be null. */
type FeedbackRow = Database['public']['Functions']['admin_user_feedback_list']['Returns'][number];

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapOverview(r: RawOverview): AdminSurveyOverviewItem {
  return {
    slug: r.slug,
    titleHe: r.title_he,
    descriptionHe: r.description_he,
    isActive: r.is_active,
    currentVersion: r.current_version,
    questionCount: r.question_count,
    respondentCount: r.respondent_count,
    responseTotal: r.response_total,
    lastResponseAt: r.last_response_at,
  };
}

function mapQuestionStat(q: RawQuestionStat): AdminSurveyQuestionStat {
  const avg = q.avg_rating == null ? null : Number(q.avg_rating);
  return {
    id: q.id,
    sortOrder: q.sort_order,
    questionType: q.question_type,
    shortLabelHe: q.short_label_he,
    promptHe: q.prompt_he,
    ratingAnchorLowHe: q.rating_anchor_low_he,
    ratingAnchorHighHe: q.rating_anchor_high_he,
    responseCount: q.response_count,
    avgRating: avg,
    distribution: q.distribution ?? [],
    choiceCounts: (q.choice_counts ?? []).map((c) => ({
      key: c.key,
      labelHe: c.label_he,
      count: c.count,
    })),
  };
}

function mapRespondent(r: RawRespondent): AdminSurveyRespondent {
  return {
    userId: r.user_id,
    displayName: r.display_name,
    submittedAt: r.submitted_at,
    answers: (r.answers ?? []).map((a) => ({
      questionId: a.question_id,
      rating: a.rating,
      choiceKey: a.choice_key ?? null,
      answerText: a.answer_text,
    })),
  };
}

function mapResults(raw: RawResults): AdminSurveyResults {
  return {
    slug: raw.slug,
    titleHe: raw.title_he,
    version: raw.version,
    respondentCount: raw.respondent_count,
    questions: (raw.questions ?? []).map(mapQuestionStat),
    respondents: (raw.respondents ?? []).map(mapRespondent),
  };
}

function mapFeedback(r: FeedbackRow): AdminFeedbackEntry {
  return {
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name ?? null,
    rating: r.rating ?? null,
    body: r.body,
    createdAt: r.created_at,
  };
}

/**
 * Maps a failed staff read by its stable refusal: `forbidden` (a caller below moderator) and
 * `survey_has_no_choice_question` are `validation`, `survey_not_found` is `not_found`. A
 * missing backend object stays a `BackendUnavailableError`; anything else is `network`.
 */
function toSurveyAdminError(error: unknown): Error {
  if (error instanceof BackendUnavailableError) return error;
  const reason = refusalReason(error);
  if (reason === 'survey_not_found') return new SurveyError('not_found', reason, { cause: error });
  if (reason === 'forbidden' || reason === 'survey_has_no_choice_question') {
    return new SurveyError('validation', reason, { cause: error });
  }
  return new SurveyError('network', reason ?? (error instanceof Error ? error.message : 'unknown'), { cause: error });
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SupabaseSurveyAdminRepository implements ISurveyAdminRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Runs one call and maps every failure with {@link toSurveyAdminError}. */
  private async call<T>(object: string, request: () => PromiseLike<CallResult<T>>): Promise<T> {
    try {
      return unwrapCall(object, await request());
    } catch (error) {
      throw toSurveyAdminError(error);
    }
  }

  async listOverview(): Promise<AdminSurveyOverviewItem[]> {
    const data = await this.call('rpc:admin_survey_overview', () => this.client.rpc('admin_survey_overview'));
    return ((data ?? []) as unknown as RawOverview[]).map(mapOverview);
  }

  async getResults(slug: string): Promise<AdminSurveyResults> {
    const data = await this.call('rpc:admin_survey_results', () =>
      this.client.rpc('admin_survey_results', { p_slug: slug }),
    );
    return mapResults(data as unknown as RawResults);
  }

  async getPmfReport(slug: string): Promise<PmfSurveyReport> {
    const data = await this.call('rpc:admin_pmf_survey_report', () =>
      this.client.rpc('admin_pmf_survey_report', { p_slug: slug }),
    );
    return mapPmfSurveyReport(data as unknown as RawPmfSurveyReport);
  }

  async listFeedback(
    limit: number,
    after: Pick<AdminFeedbackEntry, 'createdAt' | 'id'> | null,
  ): Promise<AdminFeedbackEntry[]> {
    const rows = await this.call('rpc:admin_user_feedback_list', () =>
      this.client.rpc('admin_user_feedback_list', {
        p_limit: limit,
        p_cursor: after ? { t: after.createdAt, id: after.id } : undefined,
      }),
    );
    return (rows ?? []).map(mapFeedback);
  }
}
