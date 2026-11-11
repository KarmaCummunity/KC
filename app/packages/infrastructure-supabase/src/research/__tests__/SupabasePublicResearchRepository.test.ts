// SupabasePublicResearchRepository: both calls go through the `public-research-submit` Edge
// Function (questions with `{ action: 'questions', slug }`, responses with the form body);
// its HTTP answers map to PublicResearchError codes and a function that is not deployed (404)
// to BackendUnavailableError.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError, PublicResearchError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabasePublicResearchRepository } from '../SupabasePublicResearchRepository';

type Invoke = ReturnType<typeof vi.fn>;

function makeRepo(result: { data: unknown; error: unknown }): { repo: SupabasePublicResearchRepository; invoke: Invoke } {
  const invoke = vi.fn().mockResolvedValue(result);
  const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
  return { repo: new SupabasePublicResearchRepository(client), invoke };
}

const httpError = (status: number) => ({ name: 'FunctionsHttpError', message: 'non-2xx', context: { status } });

const BUNDLE_RAW = {
  slug: 'market-research-2026',
  title_he: 'Market research',
  description_he: null,
  version: 1,
  questions: [
    {
      id: 'q-001', sort_order: 1, question_type: 'rating_1_7_with_optional_text', short_label_he: 'recommend',
      prompt_he: 'How likely?', context_he: 'context', text_placeholder_he: 'why', rating_anchor_low_he: 'low',
      rating_anchor_high_he: 'high', choice_options: null,
    },
  ],
};

const SUBMISSION = {
  slug: 'market-research-2026',
  version: 1,
  source: 'web',
  answers: [{ questionId: 'q-001', rating: 6, answerText: 'great' }],
  contactEmail: 'user@example.com',
  contactWindowHe: 'mornings',
  honeypot: '',
};

describe('SupabasePublicResearchRepository.loadBundle', () => {
  it('asks the function for the questions and maps them', async () => {
    const { repo, invoke } = makeRepo({ data: BUNDLE_RAW, error: null });
    const bundle = await repo.loadBundle('market-research-2026');
    expect(invoke).toHaveBeenCalledWith('public-research-submit', {
      body: { action: 'questions', slug: 'market-research-2026' },
    });
    expect(bundle).toEqual({
      slug: 'market-research-2026',
      titleHe: 'Market research',
      version: 1,
      questions: [{
        id: 'q-001', sortOrder: 1, questionType: 'rating_1_7_with_optional_text', shortLabelHe: 'recommend',
        promptHe: 'How likely?', contextHe: 'context', textPlaceholderHe: 'why', ratingAnchorLowHe: 'low',
        ratingAnchorHighHe: 'high', choiceOptions: [],
      }],
    });
  });

  it('maps an unknown survey (HTTP 400) to survey_not_found', async () => {
    const { repo } = makeRepo({ data: null, error: httpError(400) });
    const error = await repo.loadBundle('gone').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicResearchError);
    expect(error).toMatchObject({ code: 'survey_not_found' });
  });

  it('reports a function that is not deployed as unavailable', async () => {
    const { repo } = makeRepo({ data: null, error: httpError(404) });
    await expect(repo.loadBundle('market-research-2026')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabasePublicResearchRepository.submit', () => {
  it('sends the answers keyed by question id and returns the response id', async () => {
    const { repo, invoke } = makeRepo({ data: { responseId: 'resp-uuid-123' }, error: null });
    await expect(repo.submit({ ...SUBMISSION, honeypot: null })).resolves.toEqual({ responseId: 'resp-uuid-123' });
    expect(invoke).toHaveBeenCalledWith('public-research-submit', {
      body: {
        slug: 'market-research-2026', version: 1, source: 'web', honeypot: '',
        answers: { 'q-001': { rating: 6, answer_text: 'great' } },
        contactEmail: 'user@example.com', contactWindowHe: 'mornings',
      },
    });
  });

  it.each([
    [429, { code: 'rate_limited' }],
    [503, { code: 'circuit_open' }],
    [400, { code: 'survey_not_found' }],
    [403, { code: 'network', detail: 'origin_not_allowed' }],
  ])('maps HTTP %i to a PublicResearchError', async (status, expected) => {
    const { repo } = makeRepo({ data: null, error: httpError(status) });
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject(expected);
  });

  it('maps a network failure and a missing response id to network', async () => {
    const { repo } = makeRepo({ data: null, error: new Error('fetch failed') });
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({ code: 'network' });
    const { repo: empty } = makeRepo({ data: {}, error: null });
    await expect(empty.submit(SUBMISSION)).rejects.toMatchObject({ code: 'network', detail: 'missing_response_id' });
  });
});
