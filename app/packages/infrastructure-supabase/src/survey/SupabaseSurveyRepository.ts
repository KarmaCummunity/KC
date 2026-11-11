// SupabaseSurveyRepository — adapter for ISurveyRepository (FR-SETTINGS-015..017) on the
// baseline (supabase/schemas/90_research). Reads are table reads (surveyReads.ts); answers go
// through upsert_survey_answers, the prompt rule through check_survey_prompt_eligibility and
// free feedback is a direct insert into user_feedback. Zero business logic.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISurveyRepository } from '@kc/application';
import {
  BackendUnavailableError,
  SurveyError,
  type SurveyAnswerDraft,
  type SurveyBundle,
  type SurveyListItem,
  type SurveyPromptEligibility,
} from '@kc/domain';
import type { Database, Json } from '../database.types';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';
import { refusalReason } from '../admin/refusalReason';
import { listActiveSurveys, loadSurveyBundle } from './surveyReads';

/**
 * Maps a failed survey call by its stable refusal: an unknown or retired survey is
 * `not_found`, an answer that does not fit its question is `validation`. A missing backend
 * object stays a `BackendUnavailableError`; any other failure is `network`.
 */
export function toSurveyError(error: unknown): Error {
  if (error instanceof BackendUnavailableError || error instanceof SurveyError) return error;
  const reason = refusalReason(error);
  if (reason === 'survey_not_found') return new SurveyError('not_found', reason, { cause: error });
  if (reason === 'invalid_input') return new SurveyError('validation', reason, { cause: error });
  const detail = reason ?? (error instanceof Error ? error.message : 'unknown');
  return new SurveyError('network', detail, { cause: error });
}

export class SupabaseSurveyRepository implements ISurveyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Runs one step and maps every failure with {@link toSurveyError}. */
  private async run<T>(step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      throw toSurveyError(error);
    }
  }

  private call<T>(object: string, request: () => PromiseLike<CallResult<T>>): Promise<T> {
    return this.run(async () => unwrapCall(object, await request()));
  }

  listActive(): Promise<SurveyListItem[]> {
    return this.run(() => listActiveSurveys(this.client));
  }

  getBundle(slug: string): Promise<SurveyBundle> {
    return this.run(() => loadSurveyBundle(this.client, slug));
  }

  async upsertAnswers(slug: string, answers: SurveyAnswerDraft[]): Promise<void> {
    const payload: Json = answers.map((a) => ({
      question_id: a.questionId,
      rating: a.rating,
      choice_key: a.choiceKey,
      answer_text: a.answerText ?? null,
    }));
    await this.call('rpc:upsert_survey_answers', () =>
      this.client.rpc('upsert_survey_answers', { p_slug: slug, p_answers: payload }),
    );
  }

  async checkPromptEligibility(slug: string, clientSessionCount: number): Promise<SurveyPromptEligibility> {
    const data = await this.call('rpc:check_survey_prompt_eligibility', () =>
      this.client.rpc('check_survey_prompt_eligibility', { p_slug: slug, p_session_count: clientSessionCount }),
    );
    const raw = (data ?? {}) as { show?: unknown };
    return { show: raw.show === true, slug };
  }

  async submitFreeFeedback(input: { rating: number | null; body: string }): Promise<void> {
    const { data } = await this.client.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw new SurveyError('network', 'unauthenticated');
    await this.call('table:user_feedback', () =>
      this.client.from('user_feedback').insert({ user_id: userId, rating: input.rating, body: input.body.trim() }),
    );
  }
}
