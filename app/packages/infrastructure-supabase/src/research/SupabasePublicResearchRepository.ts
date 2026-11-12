// SupabasePublicResearchRepository — adapter for IPublicResearchRepository (FR-RESEARCH-001..003).
// The page has no account. It reads the questions with `get_public_research_questions`, which the
// baseline grants to signed-out callers (supabase/schemas/90_research/030_public_research.sql),
// and stores a response through the `public-research-submit` Edge Function, which adds the origin
// check and address hashing. Zero business logic — only the calls, mapping, and error wrapping.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicResearchRepository } from '@kc/application';
import {
  PublicResearchError,
  type PublicResearchBundle,
  type PublicResearchSubmission,
  type PublicResearchSubmitResult,
  type SurveyQuestion,
  type SurveyQuestionType,
} from '@kc/domain';
import type { Database } from '../database.types';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';

const FUNCTION_NAME = 'public-research-submit';

/** A question as `get_public_research_questions` returns it (the table row as JSON). */
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
  choice_options: { key: string; label_he: string }[] | null;
}

interface RawBundle {
  slug: string;
  title_he: string;
  version: number;
  questions: RawQuestion[] | null;
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

function mapBundle(raw: RawBundle): PublicResearchBundle {
  return {
    slug: raw.slug,
    titleHe: raw.title_he,
    version: raw.version,
    questions: (raw.questions ?? []).map(mapQuestion),
  };
}

/**
 * Edge Function failure → error. A function that is not deployed (HTTP 404) is a
 * `BackendUnavailableError`; the function's own answers map by status.
 */
function mapEdgeFunctionError(error: unknown): Error {
  const unavailable = toBackendUnavailable(`fn:${FUNCTION_NAME}`, error as BackendErrorLike);
  if (unavailable) return unavailable;
  const status =
    (error as { context?: { status?: number }; status?: number }).context?.status ??
    (error as { status?: number }).status;

  if (status === 429) return new PublicResearchError('rate_limited', 'rate_limited');
  if (status === 503) return new PublicResearchError('circuit_open', 'circuit_open');
  if (status === 400) return new PublicResearchError('survey_not_found', 'survey_not_found');
  if (status === 403) return new PublicResearchError('network', 'origin_not_allowed');

  const msg = error instanceof Error ? error.message : String(error);
  return new PublicResearchError('network', msg);
}

export class SupabasePublicResearchRepository implements IPublicResearchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async loadBundle(slug: string): Promise<PublicResearchBundle> {
    const { data, error } = await this.client.rpc('get_public_research_questions', { p_slug: slug });
    if (error) {
      const unavailable = toBackendUnavailable('rpc:get_public_research_questions', error);
      if (unavailable) throw unavailable;
      throw new PublicResearchError('network', error.message);
    }
    // Null when the survey does not exist or is not active.
    const raw = data as unknown as RawBundle | null;
    if (!raw?.slug) throw new PublicResearchError('survey_not_found', 'survey_not_found');
    return mapBundle(raw);
  }

  async submit(payload: PublicResearchSubmission): Promise<PublicResearchSubmitResult> {
    const answersPayload = Object.fromEntries(
      payload.answers.map((a) => [a.questionId, { rating: a.rating, answer_text: a.answerText }]),
    );

    const { data, error } = await this.client.functions.invoke(FUNCTION_NAME, {
      body: {
        slug: payload.slug,
        version: payload.version,
        source: payload.source,
        answers: answersPayload,
        honeypot: payload.honeypot ?? '',
        contactEmail: payload.contactEmail,
        contactWindowHe: payload.contactWindowHe,
      },
    });
    if (error) throw mapEdgeFunctionError(error);

    const result = data as { responseId?: string } | null;
    if (!result?.responseId) {
      throw new PublicResearchError('network', 'missing_response_id');
    }
    return { responseId: result.responseId };
  }
}
