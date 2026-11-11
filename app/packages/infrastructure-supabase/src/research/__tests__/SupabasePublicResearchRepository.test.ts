/**
 * Unit tests for SupabasePublicResearchRepository.
 * Uses a manually-crafted mock — no live Supabase instance.
 * Integration tests against a local Supabase fixture are deferred
 * (no local-Supabase fixture in CI per existing repo pattern).
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PublicResearchError } from '@kc/domain';
import type { Database } from '../../database.legacy.types';
import { SupabasePublicResearchRepository } from '../SupabasePublicResearchRepository';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type MockClient = SupabaseClient<Database> & {
  rpc: ReturnType<typeof vi.fn>;
  functions: {
    invoke: {
      mock: {
        calls: [[string, { body: Record<string, unknown> }], ...unknown[]];
      };
    };
  };
};

function makeClient(opts: {
  rpcResult?: { data: unknown; error: { message: string } | null };
  invokeResult?: { data: unknown; error: unknown };
} = {}): MockClient {
  const rpcResult = opts.rpcResult ?? { data: null, error: null };
  const invokeResult = opts.invokeResult ?? { data: null, error: null };

  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    functions: {
      invoke: vi.fn().mockResolvedValue(invokeResult),
    },
  } as unknown as MockClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BUNDLE_RAW = {
  slug: 'market-research-2026',
  title_he: 'מחקר שוק',
  version: 1,
  questions: [
    {
      id: 'q-001',
      sort_order: 1,
      question_type: 'rating_1_7_with_optional_text',
      short_label_he: 'המלצה',
      prompt_he: 'כמה סביר שתמליץ?',
      context_he: 'הסבר כאן',
      text_placeholder_he: 'הסבר קצר',
      rating_anchor_low_he: 'לא סביר',
      rating_anchor_high_he: 'בוודאי',
    },
  ],
};

const SUBMISSION = {
  slug: 'market-research-2026',
  version: 1,
  source: 'web',
  answers: [{ questionId: 'q-001', rating: 6, answerText: 'great' }],
  contactEmail: 'user@example.com',
  contactWindowHe: 'בוקר',
  honeypot: '',
};

// ---------------------------------------------------------------------------
// loadBundle — happy path
// ---------------------------------------------------------------------------

describe('SupabasePublicResearchRepository.loadBundle', () => {
  it('maps snake_case JSON to camelCase PublicResearchBundle', async () => {
    const client = makeClient({ rpcResult: { data: BUNDLE_RAW, error: null } });
    const repo = new SupabasePublicResearchRepository(client);
    const bundle = await repo.loadBundle('market-research-2026');

    expect(bundle.slug).toBe('market-research-2026');
    expect(bundle.titleHe).toBe('מחקר שוק');
    expect(bundle.version).toBe(1);
    expect(bundle.questions).toHaveLength(1);

    const [q] = bundle.questions;
    expect(q?.id).toBe('q-001');
    expect(q?.sortOrder).toBe(1);
    expect(q?.questionType).toBe('rating_1_7_with_optional_text');
    expect(q?.shortLabelHe).toBe('המלצה');
    expect(q?.promptHe).toBe('כמה סביר שתמליץ?');
    expect(q?.contextHe).toBe('הסבר כאן');
    expect(q?.textPlaceholderHe).toBe('הסבר קצר');
    expect(q?.ratingAnchorLowHe).toBe('לא סביר');
    expect(q?.ratingAnchorHighHe).toBe('בוודאי');
  });

  it('calls RPC with correct p_slug argument', async () => {
    const client = makeClient({ rpcResult: { data: BUNDLE_RAW, error: null } });
    const repo = new SupabasePublicResearchRepository(client);
    await repo.loadBundle('market-research-2026');
    expect(client.rpc).toHaveBeenCalledWith('get_public_research_questions', {
      p_slug: 'market-research-2026',
    });
  });

  it('throws PublicResearchError(survey_not_found) when RPC message includes survey_not_found', async () => {
    const client = makeClient({
      rpcResult: { data: null, error: { message: 'survey_not_found: market-research-2026' } },
    });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.loadBundle('market-research-2026')).rejects.toMatchObject({
      code: 'survey_not_found',
    });
    await expect(repo.loadBundle('market-research-2026')).rejects.toBeInstanceOf(
      PublicResearchError,
    );
  });

  it('throws PublicResearchError(network) on generic RPC error', async () => {
    const client = makeClient({
      rpcResult: { data: null, error: { message: 'connection timeout' } },
    });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.loadBundle('market-research-2026')).rejects.toMatchObject({
      code: 'network',
    });
  });
});

// ---------------------------------------------------------------------------
// submit — happy path + body shape
// ---------------------------------------------------------------------------

describe('SupabasePublicResearchRepository.submit', () => {
  it('returns responseId from Edge Function response', async () => {
    const client = makeClient({
      invokeResult: { data: { responseId: 'resp-uuid-123' }, error: null },
    });
    const repo = new SupabasePublicResearchRepository(client);
    const result = await repo.submit(SUBMISSION);
    expect(result.responseId).toBe('resp-uuid-123');
  });

  it('sends answers keyed by questionId with snake_case nested keys', async () => {
    const client = makeClient({
      invokeResult: { data: { responseId: 'resp-uuid-123' }, error: null },
    });
    const repo = new SupabasePublicResearchRepository(client);
    await repo.submit(SUBMISSION);

    const invokeArgs = client.functions.invoke.mock.calls[0];
    expect(invokeArgs[0]).toBe('public-research-submit');
    const body = invokeArgs[1].body;
    expect(body.slug).toBe('market-research-2026');
    expect(body.version).toBe(1);
    expect(body.source).toBe('web');
    expect(body.honeypot).toBe('');
    expect(body.contactEmail).toBe('user@example.com');
    expect(body.contactWindowHe).toBe('בוקר');
    // answers keyed by questionId, nested values in snake_case
    expect(body.answers).toEqual({
      'q-001': { rating: 6, answer_text: 'great' },
    });
  });

  it('sends empty string for null honeypot', async () => {
    const client = makeClient({
      invokeResult: { data: { responseId: 'resp-uuid-123' }, error: null },
    });
    const repo = new SupabasePublicResearchRepository(client);
    await repo.submit({ ...SUBMISSION, honeypot: null });
    const body = client.functions.invoke.mock.calls[0][1].body;
    expect(body.honeypot).toBe('');
  });

  it('throws PublicResearchError(rate_limited) on HTTP 429', async () => {
    const error = { context: { status: 429 } };
    const client = makeClient({ invokeResult: { data: null, error } });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('throws PublicResearchError(circuit_open) on HTTP 503', async () => {
    const error = { context: { status: 503 } };
    const client = makeClient({ invokeResult: { data: null, error } });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({ code: 'circuit_open' });
  });

  it('throws PublicResearchError(survey_not_found) on HTTP 400', async () => {
    const error = { context: { status: 400 } };
    const client = makeClient({ invokeResult: { data: null, error } });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({ code: 'survey_not_found' });
  });

  it('throws PublicResearchError(network, origin_not_allowed) on HTTP 403', async () => {
    const error = { context: { status: 403 } };
    const client = makeClient({ invokeResult: { data: null, error } });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({
      code: 'network',
      detail: 'origin_not_allowed',
    });
  });

  it('throws PublicResearchError(network) on generic Edge Function error', async () => {
    const error = new Error('fetch failed');
    const client = makeClient({ invokeResult: { data: null, error } });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({ code: 'network' });
  });

  it('throws PublicResearchError(network, missing_response_id) when responseId is absent', async () => {
    const client = makeClient({ invokeResult: { data: {}, error: null } });
    const repo = new SupabasePublicResearchRepository(client);
    await expect(repo.submit(SUBMISSION)).rejects.toMatchObject({
      code: 'network',
      detail: 'missing_response_id',
    });
  });
});
