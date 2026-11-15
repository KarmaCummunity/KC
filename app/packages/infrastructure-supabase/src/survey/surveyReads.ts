// Survey reads on the baseline (supabase/schemas/90_research/010_surveys.sql): the catalog,
// the questions of a survey's current version and the caller's own answers are plain table
// reads under RLS (FR-SETTINGS-015, FR-SETTINGS-016). The super admin may read every answer
// and retired surveys too, so every read filters on the caller and on active surveys itself.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SurveyError,
  type SurveyAnswerDraft,
  type SurveyBundle,
  type SurveyCompletionStatus,
  type SurveyListItem,
  type SurveyQuestion,
  type SurveyQuestionType,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;
type QuestionRow = Database['public']['Tables']['survey_questions']['Row'];
type AnswerRow = Pick<
  Database['public']['Tables']['survey_answers']['Row'],
  'question_id' | 'rating' | 'choice_key' | 'answer_text'
>;
/** A survey as both reads select it, with its versions (and, for the list, their question ids). */
type SurveyRow = {
  readonly id: string;
  readonly slug: string;
  readonly title_he: string;
  readonly description_he: string | null;
  readonly current_version: number;
  readonly survey_versions: readonly { id: string; version: number; survey_questions?: readonly { id: string }[] }[];
};

async function callerId(client: Client): Promise<string> {
  const { data } = await client.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new SurveyError('network', 'unauthenticated');
  return id;
}

/** The version row a survey is on now; a published survey always has one. */
function currentVersionOf(survey: SurveyRow) {
  return survey.survey_versions.find((v) => v.version === survey.current_version) ?? null;
}

function completionOf(questionIds: readonly string[], answered: ReadonlySet<string>): SurveyCompletionStatus {
  const done = questionIds.filter((id) => answered.has(id)).length;
  if (done === 0) return 'not_started';
  return done === questionIds.length ? 'completed' : 'in_progress';
}

function mapQuestion(q: QuestionRow): SurveyQuestion {
  const options = (q.choice_options ?? []) as { key: string; label_he: string }[];
  return {
    id: q.id,
    sortOrder: q.sort_order,
    questionType: q.question_type as SurveyQuestionType,
    shortLabelHe: q.short_label_he,
    promptHe: q.prompt_he,
    contextHe: q.context_he,
    textPlaceholderHe: q.text_placeholder_he,
    ratingAnchorLowHe: q.rating_anchor_low_he,
    ratingAnchorHighHe: q.rating_anchor_high_he,
    choiceOptions: options.map((o) => ({ key: o.key, labelHe: o.label_he })),
  };
}

function mapAnswer(a: AnswerRow): SurveyAnswerDraft {
  return { questionId: a.question_id, rating: a.rating, choiceKey: a.choice_key, answerText: a.answer_text };
}

/** Active, published surveys, oldest first, with the caller's progress on the current version. */
export async function listActiveSurveys(client: Client): Promise<SurveyListItem[]> {
  const userId = await callerId(client);
  const surveys = unwrapCall('table:surveys', await client
    .from('surveys')
    .select('id, slug, title_he, description_he, current_version, survey_versions(id, version, survey_questions(id))')
    .eq('is_active', true)
    .gt('current_version', 0)
    .order('created_at', { ascending: true }));
  const answers = unwrapCall('table:survey_answers', await client
    .from('survey_answers')
    .select('question_id')
    .eq('user_id', userId));
  const answered = new Set((answers ?? []).map((a) => a.question_id));
  return (surveys ?? []).map((s) => ({
    slug: s.slug,
    titleHe: s.title_he,
    descriptionHe: s.description_he,
    currentVersion: s.current_version,
    completionStatus: completionOf((currentVersionOf(s)?.survey_questions ?? []).map((q) => q.id), answered),
  }));
}

/** An active survey's current questions and the caller's answers to them. */
export async function loadSurveyBundle(client: Client, slug: string): Promise<SurveyBundle> {
  const userId = await callerId(client);
  const survey = unwrapCall('table:surveys', await client
    .from('surveys')
    .select('id, slug, title_he, description_he, current_version, survey_versions(id, version)')
    .eq('slug', slug)
    .eq('is_active', true)
    .gt('current_version', 0)
    .maybeSingle());
  const version = survey ? currentVersionOf(survey) : null;
  if (!survey || !version) throw new SurveyError('not_found', 'survey_not_found');
  const questions = unwrapCall('table:survey_questions', await client
    .from('survey_questions')
    .select('*')
    .eq('survey_version_id', version.id)
    .order('sort_order', { ascending: true }));
  const ids = (questions ?? []).map((q) => q.id);
  const answers = ids.length === 0 ? [] : unwrapCall('table:survey_answers', await client
    .from('survey_answers')
    .select('question_id, rating, choice_key, answer_text')
    .eq('user_id', userId)
    .in('question_id', ids));
  return {
    slug: survey.slug,
    titleHe: survey.title_he,
    version: survey.current_version,
    questions: (questions ?? []).map(mapQuestion),
    answers: (answers ?? []).map(mapAnswer),
  };
}
