/**
 * KC#1058 — single-choice bundle mapping, the admin PMF report and active-day recording.
 * RPC mocks only; the SQL behaviour is covered by supabase/tests/0458_pmf_survey.sql.
 * (Active-day recording moved with the identity package: SupabaseUserActivityRepository.test.ts.)
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { SupabaseSurveyRepository } from '../SupabaseSurveyRepository';
import { SupabaseSurveyAdminRepository } from '../SupabaseSurveyAdminRepository';

type RpcOverrides = Record<string, { data: unknown; error: { message: string } | null }>;

/** RPC-only fake: `rpc` resolves the canned result for its function name. */
function makeClient(rpcResults: RpcOverrides = {}) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(rpcResults[name] ?? { data: null, error: null }),
  );
  return { rpc, typed: { rpc } as unknown as SupabaseClient<Database> };
}

const PMF_QUESTION = {
  id: 'q-pmf',
  sort_order: 1,
  question_type: 'single_choice_with_optional_text',
  short_label_he: 'בלי קהילת קארמה',
  prompt_he: 'איך היית מרגיש/ה?',
  context_he: '',
  text_placeholder_he: 'מה הדבר העיקרי?',
  rating_anchor_low_he: 'לא מספיק',
  rating_anchor_high_he: 'מצוין',
  choice_options: [
    { key: 'very_disappointed', label_he: 'מאוד מאוכזב/ת' },
    { key: 'not_disappointed', label_he: 'לא מאוכזב/ת' },
  ],
};

describe('SupabaseSurveyRepository — single-choice bundle', () => {
  it('maps choice options and a stored choice answer', async () => {
    const client = makeClient({
      get_survey_bundle: {
        data: {
          slug: 'pmf-sean-ellis',
          title_he: 'שאלה אחת קצרה',
          version: 1,
          questions: [PMF_QUESTION],
          answers: [{ question_id: 'q-pmf', rating: null, choice_key: 'very_disappointed', answer_text: null }],
        },
        error: null,
      },
    });
    const bundle = await new SupabaseSurveyRepository(client.typed).getBundle('pmf-sean-ellis');

    expect(bundle.questions[0]?.questionType).toBe('single_choice_with_optional_text');
    expect(bundle.questions[0]?.choiceOptions).toEqual([
      { key: 'very_disappointed', labelHe: 'מאוד מאוכזב/ת' },
      { key: 'not_disappointed', labelHe: 'לא מאוכזב/ת' },
    ]);
    expect(bundle.answers[0]).toEqual({
      questionId: 'q-pmf',
      rating: null,
      choiceKey: 'very_disappointed',
      answerText: null,
    });
  });

  it('gives a rating question an empty option list when the server sends none', async () => {
    const client = makeClient({
      get_survey_bundle: {
        data: {
          slug: 'ux-experience',
          title_he: 't',
          version: 1,
          questions: [{ ...PMF_QUESTION, question_type: 'rating_1_7_with_optional_text', choice_options: null }],
          answers: [],
        },
        error: null,
      },
    });
    const bundle = await new SupabaseSurveyRepository(client.typed).getBundle('ux-experience');
    expect(bundle.questions[0]?.choiceOptions).toEqual([]);
  });
});

describe('SupabaseSurveyAdminRepository.getPmfReport', () => {
  it('calls the report RPC and maps the counts', async () => {
    const client = makeClient({
      admin_pmf_survey_report: {
        data: {
          slug: 'pmf-sean-ellis',
          title_he: 'שאלה אחת קצרה',
          version: 1,
          question_id: 'q-pmf',
          prompt_he: 'איך היית מרגיש/ה?',
          min_active_days_14d: 2,
          respondents_total: 9,
          respondents_qualified: 7,
          options: [{ key: 'very_disappointed', label_he: 'מאוד', count: 4, retention_base: 3, retained: 2 }],
        },
        error: null,
      },
    });
    const report = await new SupabaseSurveyAdminRepository(client.typed).getPmfReport('pmf-sean-ellis');

    expect(client.rpc).toHaveBeenCalledWith('admin_pmf_survey_report', { p_slug: 'pmf-sean-ellis' });
    expect(report).toEqual({
      slug: 'pmf-sean-ellis',
      titleHe: 'שאלה אחת קצרה',
      version: 1,
      promptHe: 'איך היית מרגיש/ה?',
      minActiveDays14d: 2,
      respondentsTotal: 9,
      respondentsQualified: 7,
      options: [{ key: 'very_disappointed', labelHe: 'מאוד', count: 4, retentionBase: 3, retained: 2 }],
    });
  });

  it('maps a report with null options to empty options array', async () => {
    const client = makeClient({
      admin_pmf_survey_report: {
        data: {
          slug: 'pmf-null-options',
          title_he: 'Short Title',
          version: 1,
          prompt_he: 'Question',
          min_active_days_14d: 0,
          respondents_total: 0,
          respondents_qualified: 0,
          options: null,
        },
        error: null,
      },
    });
    const report = await new SupabaseSurveyAdminRepository(client.typed).getPmfReport('pmf-null-options');
    expect(report.options).toEqual([]);
  });

  it('maps a survey without a choice question to a validation error', async () => {
    const client = makeClient({
      admin_pmf_survey_report: { data: null, error: { message: 'survey_has_no_choice_question' } },
    });
    await expect(
      new SupabaseSurveyAdminRepository(client.typed).getPmfReport('ux-experience'),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('maps an unknown slug to not_found', async () => {
    const client = makeClient({
      admin_pmf_survey_report: { data: null, error: { message: 'survey_not_found' } },
    });
    await expect(
      new SupabaseSurveyAdminRepository(client.typed).getPmfReport('missing'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
