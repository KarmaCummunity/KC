import { vi } from 'vitest';
import type { ISurveyRepository } from '../../ports/ISurveyRepository';
import type {
  SurveyBundle,
  SurveyAnswerDraft,
  SurveyListItem,
  SurveyPromptEligibility,
  SurveyQuestion,
} from '@kc/domain';

export const makeQuestion = (overrides: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: 'q1',
  sortOrder: 1,
  questionType: 'rating_1_7_with_optional_text',
  shortLabelHe: 'המלצה',
  promptHe: 'האם תמליץ לחבר?',
  contextHe: '',
  textPlaceholderHe: 'ספר/י לנו...',
  ratingAnchorLowHe: 'בשום פנים לא',
  ratingAnchorHighHe: 'בהחלט כן',
  choiceOptions: [],
  ...overrides,
});

export const makeBundle = (overrides: Partial<SurveyBundle> = {}): SurveyBundle => ({
  slug: 'ux-experience',
  titleHe: 'חוויית משתמש',
  version: 1,
  questions: [makeQuestion()],
  answers: [],
  ...overrides,
});

export const makeListItem = (overrides: Partial<SurveyListItem> = {}): SurveyListItem => ({
  slug: 'ux-experience',
  titleHe: 'חוויית משתמש',
  descriptionHe: null,
  currentVersion: 1,
  completionStatus: 'not_started',
  ...overrides,
});

export const makeEligibility = (
  overrides: Partial<SurveyPromptEligibility> = {},
): SurveyPromptEligibility => ({
  show: true,
  slug: 'ux-experience',
  ...overrides,
});

export const makeFakeRepo = (
  impl: Partial<ISurveyRepository> = {},
): ISurveyRepository => ({
  listActive: vi.fn().mockResolvedValue([makeListItem()]),
  getBundle: vi.fn().mockResolvedValue(makeBundle()),
  upsertAnswers: vi.fn().mockResolvedValue(undefined),
  checkPromptEligibility: vi.fn().mockResolvedValue(makeEligibility()),
  submitFreeFeedback: vi.fn().mockResolvedValue(undefined),
  ...impl,
});

export const makeAnswer = (overrides: Partial<SurveyAnswerDraft> = {}): SurveyAnswerDraft => ({
  questionId: 'q1',
  rating: 5,
  choiceKey: null,
  answerText: null,
  ...overrides,
});

/** The Sean Ellis question: single choice with the standard 3 options (KC#1058). */
export const makeChoiceQuestion = (overrides: Partial<SurveyQuestion> = {}): SurveyQuestion =>
  makeQuestion({
    id: 'q-pmf',
    questionType: 'single_choice_with_optional_text',
    choiceOptions: [
      { key: 'very_disappointed', labelHe: 'מאוד מאוכזב/ת' },
      { key: 'somewhat_disappointed', labelHe: 'קצת מאוכזב/ת' },
      { key: 'not_disappointed', labelHe: 'לא מאוכזב/ת' },
    ],
    ...overrides,
  });
