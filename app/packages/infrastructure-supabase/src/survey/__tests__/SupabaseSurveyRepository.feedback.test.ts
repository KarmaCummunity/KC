/**
 * Unit tests for SupabaseSurveyRepository — checkPromptEligibility and submitFreeFeedback.
 * Split from SupabaseSurveyRepository.test.ts to stay within the 300-line file cap.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { SupabaseSurveyRepository } from '../SupabaseSurveyRepository';

// ---------------------------------------------------------------------------
// Mock factory (local copy — avoids cross-file test coupling)
// ---------------------------------------------------------------------------

type RpcOverrides = Record<string, { data: unknown; error: { message: string } | null }>;

function makeClient(opts: {
  rpcResults?: RpcOverrides;
  insertResult?: { error: { message: string } | null };
  userId?: string | null;
  authError?: { message: string } | null;
} = {}): SupabaseClient<Database> {
  const rpcResults = opts.rpcResults ?? {};
  const insertResult = opts.insertResult ?? { error: null };
  const userId = 'userId' in opts ? opts.userId : 'user-uuid';
  const authError = opts.authError ?? null;

  return {
    rpc: vi.fn().mockImplementation((name: string) => {
      const result = rpcResults[name];
      return Promise.resolve(result ?? { data: null, error: null });
    }),
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue(insertResult),
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: authError,
      }),
    },
  } as unknown as SupabaseClient<Database>;
}

const ELIGIBILITY_RAW = { show: true, reasons: ['eligible'] };

// ---------------------------------------------------------------------------
// checkPromptEligibility
// ---------------------------------------------------------------------------

describe('SupabaseSurveyRepository.checkPromptEligibility', () => {
  it('returns SurveyPromptEligibility with show=true and original slug', async () => {
    const client = makeClient({
      rpcResults: {
        check_survey_prompt_eligibility: { data: ELIGIBILITY_RAW, error: null },
      },
    });
    const repo = new SupabaseSurveyRepository(client);
    const result = await repo.checkPromptEligibility('ux-experience', 5);

    expect(result).toEqual({ show: true, slug: 'ux-experience' });
  });

  it('returns show=false when already completed', async () => {
    const client = makeClient({
      rpcResults: {
        check_survey_prompt_eligibility: {
          data: { show: false, reasons: ['already_completed'] },
          error: null,
        },
      },
    });
    const repo = new SupabaseSurveyRepository(client);
    const result = await repo.checkPromptEligibility('ux-experience', 5);

    expect(result).toEqual({ show: false, slug: 'ux-experience' });
  });

  it('calls RPC with correct p_slug and p_session_count', async () => {
    const client = makeClient({
      rpcResults: {
        check_survey_prompt_eligibility: { data: ELIGIBILITY_RAW, error: null },
      },
    });
    const repo = new SupabaseSurveyRepository(client);
    await repo.checkPromptEligibility('ux-experience', 7);

    expect(client.rpc).toHaveBeenCalledWith('check_survey_prompt_eligibility', {
      p_slug: 'ux-experience',
      p_session_count: 7,
    });
  });

  it('throws SurveyError(network) on RPC error', async () => {
    const client = makeClient({
      rpcResults: {
        check_survey_prompt_eligibility: { data: null, error: { message: 'rpc fail' } },
      },
    });
    const repo = new SupabaseSurveyRepository(client);
    await expect(repo.checkPromptEligibility('ux-experience', 3)).rejects.toMatchObject({
      code: 'network',
    });
  });
});

// ---------------------------------------------------------------------------
// submitFreeFeedback
// ---------------------------------------------------------------------------

describe('SupabaseSurveyRepository.submitFreeFeedback', () => {
  it('inserts with user_id from auth, rating, and trimmed body', async () => {
    const client = makeClient({ userId: 'user-abc' });
    const repo = new SupabaseSurveyRepository(client);
    await repo.submitFreeFeedback({ rating: 4, body: '  great app  ' });

    const fromMock = client.from('user_feedback');
    expect(client.from).toHaveBeenCalledWith('user_feedback');
    expect(fromMock.insert).toHaveBeenCalledWith({
      user_id: 'user-abc',
      rating: 4,
      body: 'great app',
    });
  });

  it('passes null rating when input.rating is null', async () => {
    const client = makeClient({ userId: 'user-abc' });
    const repo = new SupabaseSurveyRepository(client);
    await repo.submitFreeFeedback({ rating: null, body: 'just feedback' });

    const fromMock = client.from('user_feedback');
    expect(fromMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ rating: null }),
    );
  });

  it('throws SurveyError(network) when insert fails', async () => {
    const client = makeClient({
      userId: 'user-abc',
      insertResult: { error: { message: 'check constraint failed' } },
    });
    const repo = new SupabaseSurveyRepository(client);
    await expect(
      repo.submitFreeFeedback({ rating: 3, body: 'too short' }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('throws SurveyError(network) when auth.getUser returns no user', async () => {
    const client = makeClient({ userId: null });
    const repo = new SupabaseSurveyRepository(client);
    await expect(
      repo.submitFreeFeedback({ rating: 3, body: 'my feedback here' }),
    ).rejects.toMatchObject({ code: 'network' });
  });
});
