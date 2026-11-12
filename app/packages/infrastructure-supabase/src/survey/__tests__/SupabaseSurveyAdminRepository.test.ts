// SupabaseSurveyAdminRepository: the staff reads of 90_research (overview, results, PMF report,
// free feedback) map their JSON to domain types and their refusals to SurveyError. The SQL
// behaviour is covered by supabase/baseline/tests/091_research_reports.sql.
import { describe, it, expect } from 'vitest';
import { BackendUnavailableError, SurveyError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseSurveyAdminRepository } from '../SupabaseSurveyAdminRepository';

function makeRepo(config: FakeClientConfig) {
  const { client, calls } = createFakeClient(config);
  return { repo: new SupabaseSurveyAdminRepository(client), calls };
}

const OVERVIEW_ROW = {
  slug: 'pmf-sean-ellis', title_he: 'PMF', description_he: null, is_active: true, current_version: 2,
  question_count: 2, respondent_count: 5, response_total: 9, last_response_at: '2026-11-01T10:00:00Z',
};
const RESULTS = {
  slug: 'pmf-sean-ellis', title_he: 'PMF', version: 2, respondent_count: 1,
  questions: [{
    id: 'q1', sort_order: 1, question_type: 'rating_1_7_with_optional_text', short_label_he: 'use', prompt_he: 'How useful?',
    rating_anchor_low_he: 'low', rating_anchor_high_he: 'high', response_count: 1, avg_rating: '6.00',
    distribution: [0, 0, 0, 0, 0, 1, 0], choice_counts: [],
  }],
  respondents: [{
    user_id: 'u1', display_name: 'Dana', submitted_at: '2026-11-01T10:00:00Z',
    answers: [{ question_id: 'q1', rating: 6, choice_key: null, answer_text: 'great' }],
  }],
};
const PMF = {
  slug: 'pmf-sean-ellis', title_he: 'PMF', version: 2, prompt_he: 'Would you miss it?', min_active_days_14d: 2,
  respondents_total: 3, respondents_qualified: 2,
  options: [{ key: 'very_disappointed', label_he: 'very', count: 1, retention_base: 1, retained: 1 }],
};

describe('SupabaseSurveyAdminRepository', () => {
  it('maps the overview rows', async () => {
    const { repo } = makeRepo({ rpc: { admin_survey_overview: ok([OVERVIEW_ROW]) } });
    await expect(repo.listOverview()).resolves.toEqual([{
      slug: 'pmf-sean-ellis', titleHe: 'PMF', descriptionHe: null, isActive: true, currentVersion: 2,
      questionCount: 2, respondentCount: 5, responseTotal: 9, lastResponseAt: '2026-11-01T10:00:00Z',
    }]);
  });

  it('maps question statistics and respondents of the results', async () => {
    const { repo, calls } = makeRepo({ rpc: { admin_survey_results: ok(RESULTS) } });
    const results = await repo.getResults('pmf-sean-ellis');
    expect(callsTo(calls, 'admin_survey_results')[0]?.args).toEqual({ p_slug: 'pmf-sean-ellis' });
    expect(results.questions[0]).toMatchObject({ avgRating: 6, responseCount: 1, distribution: [0, 0, 0, 0, 0, 1, 0], choiceCounts: [] });
    expect(results.respondents[0]?.answers[0]).toEqual({ questionId: 'q1', rating: 6, choiceKey: null, answerText: 'great' });
  });

  it('reads the PMF counts', async () => {
    const { repo, calls } = makeRepo({ rpc: { admin_pmf_survey_report: ok(PMF) } });
    const report = await repo.getPmfReport('pmf-sean-ellis');
    expect(callsTo(calls, 'admin_pmf_survey_report')[0]?.args).toEqual({ p_slug: 'pmf-sean-ellis' });
    expect(report).toMatchObject({ respondentsTotal: 3, respondentsQualified: 2, minActiveDays14d: 2 });
    expect(report.options[0]).toEqual({ key: 'very_disappointed', labelHe: 'very', count: 1, retentionBase: 1, retained: 1 });
  });

  it('pages the free feedback by keyset', async () => {
    const row = { id: 'f2', user_id: 'u1', display_name: 'Dana', rating: null, body: 'Useful app', created_at: '2026-11-02T00:00:00Z', next_cursor: {} };
    const { repo, calls } = makeRepo({ rpc: { admin_user_feedback_list: ok([row]) } });
    await expect(repo.listFeedback(20, { createdAt: '2026-11-03T00:00:00Z', id: 'f3' })).resolves.toEqual([
      { id: 'f2', userId: 'u1', displayName: 'Dana', rating: null, body: 'Useful app', createdAt: '2026-11-02T00:00:00Z' },
    ]);
    expect(callsTo(calls, 'admin_user_feedback_list')[0]?.args).toEqual({
      p_limit: 20, p_cursor: { t: '2026-11-03T00:00:00Z', id: 'f3' },
    });
    await repo.listFeedback(50, null);
    expect(callsTo(calls, 'admin_user_feedback_list')[1]?.args).toEqual({ p_limit: 50, p_cursor: undefined });
  });

  it('maps the refusals of the staff reads', async () => {
    const { repo } = makeRepo({
      rpc: {
        admin_survey_overview: fail('42501', 'forbidden'),
        admin_survey_results: fail('P0001', 'survey_not_found'),
        admin_pmf_survey_report: fail('P0001', 'survey_has_no_choice_question'),
      },
    });
    await expect(repo.listOverview()).rejects.toMatchObject({ constructor: SurveyError, code: 'validation', detail: 'forbidden' });
    await expect(repo.getResults('nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(repo.getPmfReport('ratings-only')).rejects.toMatchObject({ code: 'validation', detail: 'survey_has_no_choice_question' });
  });

  it('reports a missing function as unavailable', async () => {
    const { repo } = makeRepo({ rpc: { admin_user_feedback_list: fail('PGRST202', 'not found') } });
    await expect(repo.listFeedback(10, null)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
