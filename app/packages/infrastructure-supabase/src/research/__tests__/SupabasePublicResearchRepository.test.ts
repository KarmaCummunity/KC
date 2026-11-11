// SupabasePublicResearchRepository: the questions come from `get_public_research_questions`
// (granted to signed-out callers; null for a survey that is missing or not active), responses go
// through the `public-research-submit` Edge Function, whose HTTP answers map to
// PublicResearchError codes; a function that is not deployed (404) is BackendUnavailableError.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError, PublicResearchError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabasePublicResearchRepository } from '../SupabasePublicResearchRepository';

type Mock = ReturnType<typeof vi.fn>;

function makeRepo(result: { data: unknown; error: unknown }): {
  repo: SupabasePublicResearchRepository;
  invoke: Mock;
  rpc: Mock;
} {
  const invoke = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn().mockResolvedValue(result);
  const client = { functions: { invoke }, rpc } as unknown as SupabaseClient<Database>;
  return { repo: new SupabasePublicResearchRepository(client), invoke, rpc };
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
  it('reads the questions with the RPC and maps them', async () => {
    const { repo, rpc, invoke } = makeRepo({ data: BUNDLE_RAW, error: null });
    const bundle = await repo.loadBundle('market-research-2026');
    expect(rpc).toHaveBeenCalledWith('get_public_research_questions', { p_slug: 'market-research-2026' });
    expect(invoke).not.toHaveBeenCalled();
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

  it('maps a missing or inactive survey (null) to survey_not_found', async () => {
    const { repo } = makeRepo({ data: null, error: null });
    const error = await repo.loadBundle('gone').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicResearchError);
    expect(error).toMatchObject({ code: 'survey_not_found' });
  });

  it('reports a function the backend does not have as unavailable, and other errors as network', async () => {
    const { repo } = makeRepo({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    await expect(repo.loadBundle('market-research-2026')).rejects.toBeInstanceOf(BackendUnavailableError);
    const { repo: failing } = makeRepo({ data: null, error: { code: '08006', message: 'connection lost' } });
    await expect(failing.loadBundle('market-research-2026')).rejects.toMatchObject({ code: 'network' });
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
