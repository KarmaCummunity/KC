// SupabaseSurveyAdminRepository — adapter for ISurveyAdminRepository (FR-ADMIN-021).
// Maps admin survey RPCs (snake_case JSON) → domain types. Zero business logic.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISurveyAdminRepository } from '@kc/application';
import {
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

interface RawFeedback {
  id: string;
  user_id: string;
  display_name: string | null;
  rating: number | null;
  body: string;
  created_at: string;
}

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

function mapFeedback(r: RawFeedback): AdminFeedbackEntry {
  return {
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    rating: r.rating,
    body: r.body,
    createdAt: r.created_at,
  };
}

function mapError(msg: string): SurveyError {
  if (msg.includes('forbidden')) return new SurveyError('validation', msg);
  if (msg.includes('survey_not_found')) return new SurveyError('not_found', msg);
  if (msg.includes('survey_has_no_choice_question')) return new SurveyError('validation', msg);
  return new SurveyError('network', msg);
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SupabaseSurveyAdminRepository implements ISurveyAdminRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listOverview(): Promise<AdminSurveyOverviewItem[]> {
    const { data, error } = await this.client.rpc('admin_survey_overview');
    if (error) throw mapError(error.message);
    const rows = (data ?? []) as unknown as RawOverview[];
    return rows.map(mapOverview);
  }

  async getResults(slug: string): Promise<AdminSurveyResults> {
    const { data, error } = await this.client.rpc('admin_survey_results', {
      p_slug: slug,
    });
    if (error) throw mapError(error.message);
    return mapResults(data as unknown as RawResults);
  }

  async getPmfReport(slug: string): Promise<PmfSurveyReport> {
    const { data, error } = await this.client.rpc('admin_pmf_survey_report', { p_slug: slug });
    if (error) throw mapError(error.message);
    return mapPmfSurveyReport(data as unknown as RawPmfSurveyReport);
  }

  async listFeedback(limit: number, offset: number): Promise<AdminFeedbackEntry[]> {
    const { data, error } = await this.client.rpc('admin_user_feedback_list', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw mapError(error.message);
    const rows = (data ?? []) as unknown as RawFeedback[];
    return rows.map(mapFeedback);
  }
}
