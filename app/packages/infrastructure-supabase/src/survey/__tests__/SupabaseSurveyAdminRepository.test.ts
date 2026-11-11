/**
 * Unit tests for SupabaseSurveyAdminRepository — listOverview, getResults,
 * listFeedback. Uses a manually-crafted RPC mock — no live Supabase instance.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { SupabaseSurveyAdminRepository } from '../SupabaseSurveyAdminRepository';

type RpcOverrides = Record<string, { data: unknown; error: { message: string } | null }>;

function makeClient(rpcResults: RpcOverrides = {}): SupabaseClient<Database> {
  return {
    rpc: vi.fn().mockImplementation((name: string) =>
      Promise.resolve(rpcResults[name] ?? { data: null, error: null }),
    ),
  } as unknown as SupabaseClient<Database>;
}

describe('SupabaseSurveyAdminRepository.listOverview', () => {
  it('maps snake_case rows to AdminSurveyOverviewItem[]', async () => {
    const client = makeClient({
      admin_survey_overview: {
        data: [
          {
            slug: 'ux-experience',
            title_he: 'סקר',
            description_he: null,
            is_active: true,
            current_version: 2,
            question_count: 6,
            respondent_count: 4,
            response_total: 20,
            last_response_at: '2026-06-01T00:00:00Z',
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseSurveyAdminRepository(client);
    const rows = await repo.listOverview();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      slug: 'ux-experience',
      titleHe: 'סקר',
      descriptionHe: null,
      isActive: true,
      currentVersion: 2,
      questionCount: 6,
      respondentCount: 4,
      responseTotal: 20,
      lastResponseAt: '2026-06-01T00:00:00Z',
    });
  });

  it('returns [] when RPC returns null data', async () => {
    const client = makeClient({ admin_survey_overview: { data: null, error: null } });
    const repo = new SupabaseSurveyAdminRepository(client);
    expect(await repo.listOverview()).toEqual([]);
  });

  it('throws SurveyError(validation) on forbidden', async () => {
    const client = makeClient({
      admin_survey_overview: { data: null, error: { message: 'forbidden' } },
    });
    const repo = new SupabaseSurveyAdminRepository(client);
    await expect(repo.listOverview()).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('SupabaseSurveyAdminRepository.getResults', () => {
  it('maps question stats and respondents, coercing avg_rating to number', async () => {
    const client = makeClient({
      admin_survey_results: {
        data: {
          slug: 'ux-experience',
          title_he: 'סקר',
          version: 1,
          respondent_count: 1,
          questions: [
            {
              id: 'q1',
              sort_order: 1,
              short_label_he: 'המלצה',
              prompt_he: 'כמה?',
              rating_anchor_low_he: 'נמוך',
              rating_anchor_high_he: 'גבוה',
              response_count: 1,
              avg_rating: '5.00',
              distribution: [0, 0, 0, 0, 1, 0, 0],
            },
            {
              id: 'q2',
              sort_order: 2,
              question_type: 'single_choice_with_optional_text',
              short_label_he: 'PMF',
              prompt_he: 'בלי?',
              rating_anchor_low_he: '',
              rating_anchor_high_he: '',
              response_count: 1,
              avg_rating: null,
              distribution: [0, 0, 0, 0, 0, 0, 0],
              choice_counts: [{ key: 'very_disappointed', label_he: 'מאוד', count: 1 }],
            },
          ],
          respondents: [
            {
              user_id: 'u1',
              display_name: 'דנה',
              submitted_at: '2026-06-01T00:00:00Z',
              answers: [
                { question_id: 'q1', rating: 5, answer_text: 'טוב' },
                { question_id: 'q2', rating: null, choice_key: 'very_disappointed', answer_text: null },
              ],
            },
          ],
        },
        error: null,
      },
    });
    const repo = new SupabaseSurveyAdminRepository(client);
    const res = await repo.getResults('ux-experience');
    expect(client.rpc).toHaveBeenCalledWith('admin_survey_results', { p_slug: 'ux-experience' });
    expect(res.questions[0]?.avgRating).toBe(5);
    expect(res.questions[0]?.distribution).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(res.respondents[0]?.displayName).toBe('דנה');
    expect(res.respondents[0]?.answers[0]).toEqual({
      questionId: 'q1',
      rating: 5,
      choiceKey: null,
      answerText: 'טוב',
    });
    // Single-choice question (KC#1058): option counts and the chosen key; rating rows stay empty.
    expect(res.questions[0]?.choiceCounts).toEqual([]);
    expect(res.questions[1]?.questionType).toBe('single_choice_with_optional_text');
    expect(res.questions[1]?.choiceCounts).toEqual([{ key: 'very_disappointed', labelHe: 'מאוד', count: 1 }]);
    expect(res.respondents[0]?.answers[1]?.choiceKey).toBe('very_disappointed');
  });

  it('throws SurveyError(not_found) when RPC raises survey_not_found', async () => {
    const client = makeClient({
      admin_survey_results: { data: null, error: { message: 'survey_not_found' } },
    });
    const repo = new SupabaseSurveyAdminRepository(client);
    await expect(repo.getResults('missing')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('SupabaseSurveyAdminRepository.listFeedback', () => {
  it('passes pagination and maps rows', async () => {
    const client = makeClient({
      admin_user_feedback_list: {
        data: [
          {
            id: 'f1',
            user_id: 'u1',
            display_name: 'דנה',
            rating: 6,
            body: 'אהבתי',
            created_at: '2026-06-01T00:00:00Z',
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseSurveyAdminRepository(client);
    const rows = await repo.listFeedback(10, 20);
    expect(client.rpc).toHaveBeenCalledWith('admin_user_feedback_list', {
      p_limit: 10,
      p_offset: 20,
    });
    expect(rows[0]).toEqual({
      id: 'f1',
      userId: 'u1',
      displayName: 'דנה',
      rating: 6,
      body: 'אהבתי',
      createdAt: '2026-06-01T00:00:00Z',
    });
  });
});
