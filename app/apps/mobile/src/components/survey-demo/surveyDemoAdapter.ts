import type { SurveyQuestion } from '@kc/domain';
import type { SurveyDemoQuestion } from './surveyDemoQuestions';

export type DemoAnswer = { readonly rating: number | null; readonly text: string };

export function toProductionQuestions(
  demoQuestions: readonly SurveyDemoQuestion[],
): SurveyQuestion[] {
  return demoQuestions.map((q) => ({
    id: q.id,
    sortOrder: 0,
    questionType: 'rating_1_7_with_optional_text' as const,
    shortLabelHe: q.shortLabel,
    promptHe: q.prompt,
    contextHe: q.context,
    textPlaceholderHe: q.textPlaceholder,
    ratingAnchorLowHe: '',
    ratingAnchorHighHe: '',
    choiceOptions: [],
  }));
}

export function toProductionAnswers(
  demoAnswers: Record<string, DemoAnswer>,
): Record<string, { rating: number | null; answerText: string }> {
  return Object.fromEntries(
    Object.entries(demoAnswers).map(([id, a]) => [
      id,
      { rating: a.rating, answerText: a.text },
    ]),
  );
}
