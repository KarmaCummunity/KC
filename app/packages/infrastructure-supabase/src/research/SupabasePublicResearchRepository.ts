// SupabasePublicResearchRepository — adapter for IPublicResearchRepository (FR-RESEARCH-001..003).
// Calls get_public_research_questions RPC (anon) and public-research-submit Edge Function.
// Zero business logic — only RPC/Edge Function calls, mapping, and error wrapping.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicResearchRepository } from '@kc/application';
import {
  PublicResearchError,
  type PublicResearchBundle,
  type PublicResearchSubmission,
  type PublicResearchSubmitResult,
} from '@kc/domain';
import type { Database } from '../database.types';

// ---------------------------------------------------------------------------
// Raw JSON shape returned by get_public_research_questions RPC (snake_case)
// ---------------------------------------------------------------------------

interface RawQuestion {
  id: string;
  sort_order: number;
  question_type: 'rating_1_7_with_optional_text';
  short_label_he: string;
  prompt_he: string;
  context_he: string;
  text_placeholder_he: string;
  rating_anchor_low_he: string;
  rating_anchor_high_he: string;
}

interface RawBundle {
  slug: string;
  title_he: string;
  version: number;
  questions: RawQuestion[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapQuestion(q: RawQuestion) {
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
    // Public research questions are rating-only.
    choiceOptions: [],
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

// ---------------------------------------------------------------------------
// Edge Function HTTP error → domain error code mapping
// ---------------------------------------------------------------------------

function mapEdgeFunctionError(error: unknown): PublicResearchError {
  // FunctionsHttpError exposes `context.status` or a top-level `status` field.
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

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SupabasePublicResearchRepository implements IPublicResearchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async loadBundle(slug: string): Promise<PublicResearchBundle> {
    const { data, error } = await this.client.rpc('get_public_research_questions', {
      p_slug: slug,
    });

    if (error) {
      if (error.message?.includes('survey_not_found')) {
        throw new PublicResearchError('survey_not_found', error.message);
      }
      throw new PublicResearchError('network', error.message);
    }

    return mapBundle(data as unknown as RawBundle);
  }

  async submit(payload: PublicResearchSubmission): Promise<PublicResearchSubmitResult> {
    // Invoke the Edge Function, NOT the RPC directly. The Edge Function
    // adds Origin validation + IP hashing before forwarding to the SECURITY
    // DEFINER RPC (FR-RESEARCH-002).
    const answersPayload = Object.fromEntries(
      payload.answers.map((a) => [
        a.questionId,
        { rating: a.rating, answer_text: a.answerText },
      ]),
    );

    const { data, error } = await this.client.functions.invoke('public-research-submit', {
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

    if (error) {
      throw mapEdgeFunctionError(error);
    }

    const result = data as { responseId?: string } | null;
    if (!result?.responseId) {
      throw new PublicResearchError('network', 'missing_response_id');
    }

    return { responseId: result.responseId };
  }
}
