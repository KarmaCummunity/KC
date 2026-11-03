import { vi } from 'vitest';
import type { IPublicResearchRepository } from '../../ports/IPublicResearchRepository';
import type {
  PublicResearchBundle,
  PublicResearchAnswerDraft,
  PublicResearchSubmission,
  PublicResearchSubmitResult,
  SurveyQuestion,
} from '@kc/domain';

export const makeQuestion = (
  overrides: Partial<SurveyQuestion> = {},
): SurveyQuestion => ({
  id: 'q1',
  sortOrder: 1,
  questionType: 'rating_1_7_with_optional_text',
  shortLabelHe: 'המלצה',
  promptHe: 'האם הפלטפורמה עונה לצרכיך?',
  contextHe: '',
  textPlaceholderHe: 'ספר/י לנו...',
  ratingAnchorLowHe: 'בשום פנים לא',
  ratingAnchorHighHe: 'בהחלט כן',
  choiceOptions: [],
  ...overrides,
});

export const makeBundle = (
  overrides: Partial<PublicResearchBundle> = {},
): PublicResearchBundle => ({
  slug: 'market-research-2024',
  titleHe: 'מחקר שוק 2024',
  version: 1,
  questions: [makeQuestion()],
  ...overrides,
});

export const makeAnswer = (
  overrides: Partial<PublicResearchAnswerDraft> = {},
): PublicResearchAnswerDraft => ({
  questionId: 'q1',
  rating: 5,
  answerText: null,
  ...overrides,
});

export const makeSubmission = (
  overrides: Partial<PublicResearchSubmission> = {},
): PublicResearchSubmission => ({
  slug: 'market-research-2024',
  version: 1,
  source: 'web',
  answers: [makeAnswer()],
  contactEmail: null,
  contactWindowHe: null,
  honeypot: null,
  ...overrides,
});

export const makeSubmitResult = (
  overrides: Partial<PublicResearchSubmitResult> = {},
): PublicResearchSubmitResult => ({
  responseId: 'resp-001',
  ...overrides,
});

export const makeFakeRepo = (
  impl: Partial<IPublicResearchRepository> = {},
): IPublicResearchRepository => ({
  loadBundle: vi.fn().mockResolvedValue(makeBundle()),
  submit: vi.fn().mockResolvedValue(makeSubmitResult()),
  ...impl,
});
