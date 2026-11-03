import { SurveyError } from '@kc/domain';
import type { SurveyBundle, SurveyAnswerDraft, SurveyQuestion } from '@kc/domain';
import type { ISurveyRepository } from '../ports/ISurveyRepository';

const MIN_RATING = 1;
const MAX_RATING = 7;

export interface SaveSurveyAnswersInput {
  readonly slug: string;
  readonly bundle: SurveyBundle;
  readonly answers: SurveyAnswerDraft[];
}

function isValidRating(rating: number | null): boolean {
  return rating != null && Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

/** A rating question takes a 1..7 rating; a single-choice question takes one of its option keys. */
function isValidValue(question: SurveyQuestion, answer: SurveyAnswerDraft): boolean {
  if (question.questionType === 'single_choice_with_optional_text') {
    return answer.rating == null && question.choiceOptions.some((o) => o.key === answer.choiceKey);
  }
  return answer.choiceKey == null && isValidRating(answer.rating);
}

function validateAnswers(bundle: SurveyBundle, answers: SurveyAnswerDraft[]): void {
  // Partial saves are intentional — the runner debounces save after each
  // answer change, so we routinely upsert before every question has an
  // answer (FR-SETTINGS-016 AC4). We only validate that:
  //   1. each provided answer's question_id belongs to the bundle
  //   2. each provided answer carries the value its question type expects
  // We do NOT require every question to have an answer.
  const questionsById = new Map(bundle.questions.map((q) => [q.id, q]));
  for (const answer of answers) {
    const question = questionsById.get(answer.questionId);
    if (!question) {
      throw new SurveyError(
        'validation',
        `unknown_question_${answer.questionId}`,
      );
    }
    if (!isValidValue(question, answer)) {
      const kind = question.questionType === 'single_choice_with_optional_text' ? 'choice' : 'rating';
      throw new SurveyError(
        'validation',
        `invalid_${kind}_for_question_${answer.questionId}`,
      );
    }
  }
}

export class SaveSurveyAnswersUseCase {
  constructor(private readonly repo: ISurveyRepository) {}

  async execute(input: SaveSurveyAnswersInput): Promise<void> {
    validateAnswers(input.bundle, input.answers);
    await this.repo.upsertAnswers(input.slug, input.answers);
  }
}
