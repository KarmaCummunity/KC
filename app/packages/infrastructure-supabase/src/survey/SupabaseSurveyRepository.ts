// SupabaseSurveyRepository — adapter for ISurveyRepository (FR-SETTINGS-015..017).
// Maps Supabase RPCs + direct inserts → domain types.  Zero business logic.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISurveyRepository } from '@kc/application';
import {
  SurveyError,
  type SurveyBundle,
  type SurveyAnswerDraft,
  type SurveyListItem,
  type SurveyPromptEligibility,
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveyCompletionStatus,
} from '@kc/domain';
import type { Database } from '../database.types';

// ---------------------------------------------------------------------------
// Raw JSON shapes returned by RPCs (snake_case from Postgres)
// ---------------------------------------------------------------------------

interface RawListItem {
  slug: string;
  title_he: string;
  description_he: string | null;
  current_version: number;
  completion_status: SurveyCompletionStatus;
}

interface RawQuestion {
  id: string;
  sort_order: number;
  question_type: SurveyQuestionType;
  short_label_he: string;
  prompt_he: string;
  context_he: string;
  text_placeholder_he: string;
  rating_anchor_low_he: string;
  rating_anchor_high_he: string;
  /** `[]` for rating questions (0456). */
  choice_options: { key: string; label_he: string }[] | null;
}

interface RawAnswer {
  question_id: string;
  rating: number | null;
  choice_key: string | null;
  answer_text: string | null;
}

interface RawBundle {
  slug: string;
  title_he: string;
  version: number;
  questions: RawQuestion[];
  answers: RawAnswer[];
}

interface RawEligibility {
  show: boolean;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapListItem(r: RawListItem): SurveyListItem {
  return {
    slug: r.slug,
    titleHe: r.title_he,
    descriptionHe: r.description_he,
    currentVersion: r.current_version,
    completionStatus: r.completion_status,
  };
}

function mapQuestion(q: RawQuestion): SurveyQuestion {
  return {
    id: q.id,
    sortOrder: q.sort_order,
    questionType: q.question_type,
    shortLabelHe: q.short_label_he,
    promptHe: q.prompt_he,
    contextHe: q.context_he,
    textPlaceholderHe: q.text_placeholder_he,
    ratingAnchorLowHe: q.rating_anchor_low_he,
    ratingAnchorHighHe: q.rating_anchor_high_he,
    choiceOptions: (q.choice_options ?? []).map((o) => ({ key: o.key, labelHe: o.label_he })),
  };
}

function mapAnswer(a: RawAnswer): SurveyAnswerDraft {
  return {
    questionId: a.question_id,
    rating: a.rating,
    choiceKey: a.choice_key ?? null,
    answerText: a.answer_text,
  };
}

function mapBundle(raw: RawBundle): SurveyBundle {
  return {
    slug: raw.slug,
    titleHe: raw.title_he,
    version: raw.version,
    questions: (raw.questions ?? []).map(mapQuestion),
    answers: (raw.answers ?? []).map(mapAnswer),
  };
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapRpcError(msg: string): SurveyError {
  if (msg.startsWith('survey_not_found_or_inactive')) {
    return new SurveyError('inactive', msg);
  }
  if (msg.startsWith('survey_not_found')) {
    return new SurveyError('not_found', msg);
  }
  if (
    msg.startsWith('invalid_rating') ||
    msg.startsWith('invalid_choice') ||
    msg.startsWith('question_not_in_current_version') ||
    msg.startsWith('answer_text_too_long')
  ) {
    return new SurveyError('validation', msg);
  }
  return new SurveyError('network', msg);
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SupabaseSurveyRepository implements ISurveyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listActive(): Promise<SurveyListItem[]> {
    const { data, error } = await this.client.rpc('list_active_surveys');
    if (error) throw mapRpcError(error.message);
    const rows = (data ?? []) as unknown as RawListItem[];
    return rows.map(mapListItem);
  }

  async getBundle(slug: string): Promise<SurveyBundle> {
    const { data, error } = await this.client.rpc('get_survey_bundle', {
      p_slug: slug,
    });
    if (error) throw mapRpcError(error.message);
    return mapBundle(data as unknown as RawBundle);
  }

  async upsertAnswers(slug: string, answers: SurveyAnswerDraft[]): Promise<void> {
    const payload = answers.map((a) => ({
      question_id: a.questionId,
      rating: a.rating,
      choice_key: a.choiceKey,
      answer_text: a.answerText ?? null,
    }));
    const { error } = await this.client.rpc('upsert_survey_answers', {
      p_slug: slug,
      p_answers: payload as unknown as import('../database.types').Database['public']['Functions']['upsert_survey_answers']['Args']['p_answers'],
    });
    if (error) throw mapRpcError(error.message);
  }

  async checkPromptEligibility(
    slug: string,
    clientSessionCount: number,
  ): Promise<SurveyPromptEligibility> {
    const { data, error } = await this.client.rpc('check_survey_prompt_eligibility', {
      p_slug: slug,
      p_session_count: clientSessionCount,
    });
    if (error) throw mapRpcError(error.message);
    const raw = data as unknown as RawEligibility;
    return { show: raw.show, slug };
  }

  async submitFreeFeedback(input: { rating: number | null; body: string }): Promise<void> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      throw new SurveyError('network', authError?.message ?? 'unauthenticated');
    }
    const { error } = await this.client.from('user_feedback').insert({
      user_id: userData.user.id,
      rating: input.rating ?? null,
      body: input.body.trim(),
    });
    if (error) throw new SurveyError('network', error.message);
  }
}
