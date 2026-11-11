// SupabaseSurveyRepository on the baseline: the catalog, questions and the caller's answers are
// table reads; answers, the prompt rule and free feedback are one RPC or insert each. The SQL
// behaviour is covered by supabase/baseline/tests/090_research.sql and 091_research_reports.sql.
import { describe, it, expect } from 'vitest';
import { BackendUnavailableError, SurveyError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseSurveyRepository } from '../SupabaseSurveyRepository';

function makeRepo(config: FakeClientConfig) {
  const { client, calls } = createFakeClient({ userId: 'u1', ...config });
  return { repo: new SupabaseSurveyRepository(client), calls };
}

const SURVEY = {
  id: 's1', slug: 'pmf-sean-ellis', title_he: 'PMF', description_he: null, current_version: 2,
  survey_versions: [
    { id: 'v1', version: 1, survey_questions: [{ id: 'old' }] },
    { id: 'v2', version: 2, survey_questions: [{ id: 'q1' }, { id: 'q2' }] },
  ],
};
const RATING_QUESTION = {
  id: 'q1', survey_version_id: 'v2', sort_order: 1, question_type: 'rating_1_7_with_optional_text',
  short_label_he: 'use', prompt_he: 'How useful?', context_he: '', text_placeholder_he: '',
  rating_anchor_low_he: 'low', rating_anchor_high_he: 'high', choice_options: null,
};
const CHOICE_QUESTION = {
  ...RATING_QUESTION, id: 'q2', sort_order: 2, question_type: 'single_choice_with_optional_text',
  choice_options: [{ key: 'very_disappointed', label_he: 'very' }, { key: 'not_disappointed', label_he: 'not' }],
};

describe('SupabaseSurveyRepository · reads', () => {
  it('lists active surveys with the caller\'s progress on the current version', async () => {
    const { repo, calls } = makeRepo({
      tables: { surveys: ok([SURVEY]), survey_answers: ok([{ question_id: 'q1' }, { question_id: 'old' }]) },
    });
    await expect(repo.listActive()).resolves.toEqual([
      { slug: 'pmf-sean-ellis', titleHe: 'PMF', descriptionHe: null, currentVersion: 2, completionStatus: 'in_progress' },
    ]);
    expect(callsTo(calls, 'surveys')[0]?.filters).toEqual([
      ['eq', 'is_active', true], ['gt', 'current_version', 0], ['order', 'created_at', { ascending: true }],
    ]);
    expect(callsTo(calls, 'survey_answers')[0]?.filters).toEqual([['eq', 'user_id', 'u1']]);
  });

  it('reports not_started and completed', async () => {
    const none = makeRepo({ tables: { surveys: ok([SURVEY]), survey_answers: ok([]) } });
    expect((await none.repo.listActive())[0]?.completionStatus).toBe('not_started');
    const all = makeRepo({ tables: { surveys: ok([SURVEY]), survey_answers: ok([{ question_id: 'q1' }, { question_id: 'q2' }]) } });
    expect((await all.repo.listActive())[0]?.completionStatus).toBe('completed');
  });

  it('loads the current version\'s questions, choice options and the caller\'s answers', async () => {
    const answer = { question_id: 'q2', rating: null, choice_key: 'very_disappointed', answer_text: null };
    const { repo, calls } = makeRepo({
      tables: { surveys: ok(SURVEY), survey_questions: ok([RATING_QUESTION, CHOICE_QUESTION]), survey_answers: ok([answer]) },
    });
    const bundle = await repo.getBundle('pmf-sean-ellis');
    expect(bundle).toMatchObject({ slug: 'pmf-sean-ellis', titleHe: 'PMF', version: 2 });
    expect(bundle.questions.map((q) => q.choiceOptions.length)).toEqual([0, 2]);
    expect(bundle.questions[1]?.choiceOptions[0]).toEqual({ key: 'very_disappointed', labelHe: 'very' });
    expect(bundle.answers).toEqual([{ questionId: 'q2', rating: null, choiceKey: 'very_disappointed', answerText: null }]);
    expect(callsTo(calls, 'survey_questions')[0]?.filters).toEqual([
      ['eq', 'survey_version_id', 'v2'], ['order', 'sort_order', { ascending: true }],
    ]);
    expect(callsTo(calls, 'survey_answers')[0]?.filters).toEqual([['eq', 'user_id', 'u1'], ['in', 'question_id', ['q1', 'q2']]]);
  });

  it('maps an unknown or retired survey to not_found and a missing table to unavailable', async () => {
    const { repo } = makeRepo({ tables: { surveys: ok(null) } });
    await expect(repo.getBundle('nope')).rejects.toMatchObject({ constructor: SurveyError, code: 'not_found' });
    const missing = makeRepo({ tables: { surveys: fail('PGRST205', 'no table') } });
    await expect(missing.repo.listActive()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseSurveyRepository · writes', () => {
  it('saves answers through upsert_survey_answers with a snake_case payload', async () => {
    const { repo, calls } = makeRepo({ rpc: { upsert_survey_answers: ok(null) } });
    await repo.upsertAnswers('pmf-sean-ellis', [
      { questionId: 'q1', rating: 6, choiceKey: null, answerText: null },
      { questionId: 'q2', rating: null, choiceKey: 'very_disappointed', answerText: 'great' },
    ]);
    expect(callsTo(calls, 'upsert_survey_answers')[0]?.args).toEqual({
      p_slug: 'pmf-sean-ellis',
      p_answers: [
        { question_id: 'q1', rating: 6, choice_key: null, answer_text: null },
        { question_id: 'q2', rating: null, choice_key: 'very_disappointed', answer_text: 'great' },
      ],
    });
  });

  it('maps the refusals of upsert_survey_answers', async () => {
    const invalid = makeRepo({ rpc: { upsert_survey_answers: fail('P0001', 'invalid_input') } });
    await expect(invalid.repo.upsertAnswers('s', [])).rejects.toMatchObject({ code: 'validation' });
    const gone = makeRepo({ rpc: { upsert_survey_answers: fail('P0001', 'survey_not_found') } });
    await expect(gone.repo.upsertAnswers('s', [])).rejects.toMatchObject({ code: 'not_found' });
    const other = makeRepo({ rpc: { upsert_survey_answers: fail('XX000', 'boom') } });
    await expect(other.repo.upsertAnswers('s', [])).rejects.toMatchObject({ code: 'network' });
  });

  it('reads the prompt rule with the device session count', async () => {
    const { repo, calls } = makeRepo({ rpc: { check_survey_prompt_eligibility: ok({ show: true, reasons: ['eligible'] }) } });
    await expect(repo.checkPromptEligibility('pmf-sean-ellis', 4)).resolves.toEqual({ show: true, slug: 'pmf-sean-ellis' });
    expect(callsTo(calls, 'check_survey_prompt_eligibility')[0]?.args).toEqual({ p_slug: 'pmf-sean-ellis', p_session_count: 4 });
    const no = makeRepo({ rpc: { check_survey_prompt_eligibility: ok({ show: false, reasons: ['already_completed'] }) } });
    await expect(no.repo.checkPromptEligibility('x', 1)).resolves.toEqual({ show: false, slug: 'x' });
  });

  it('files free feedback as the signed-in member with a trimmed text', async () => {
    const { repo, calls } = makeRepo({ tables: { user_feedback: ok(null) } });
    await repo.submitFreeFeedback({ rating: null, body: '  Useful app, thanks  ' });
    expect(callsTo(calls, 'user_feedback')[0]).toMatchObject({
      kind: 'insert', payload: { user_id: 'u1', rating: null, body: 'Useful app, thanks' },
    });
  });

  it('refuses feedback without a session and maps a failed insert', async () => {
    const signedOut = makeRepo({ userId: null });
    await expect(signedOut.repo.submitFreeFeedback({ rating: 3, body: 'Long enough text' })).rejects.toMatchObject({ code: 'network' });
    const refused = makeRepo({ tables: { user_feedback: fail('42501', 'new row violates row-level security policy') } });
    await expect(refused.repo.submitFreeFeedback({ rating: 3, body: 'Long enough text' })).rejects.toBeInstanceOf(SurveyError);
  });
});
