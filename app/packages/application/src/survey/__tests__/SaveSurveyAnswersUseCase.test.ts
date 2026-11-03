import { describe, it, expect, vi } from 'vitest';
import { SaveSurveyAnswersUseCase } from '../SaveSurveyAnswersUseCase';
import {
  makeFakeRepo,
  makeBundle,
  makeAnswer,
  makeQuestion,
  makeChoiceQuestion,
} from './surveyFakeRepository';

describe('SaveSurveyAnswersUseCase', () => {
  it('calls upsertAnswers with slug and answers when all ratings are valid', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ questionId: 'q1', rating: 5 })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await uc.execute({ slug: 'ux-experience', bundle, answers });

    expect(repo.upsertAnswers).toHaveBeenCalledWith('ux-experience', answers);
  });

  it('accepts rating at the lower boundary (1)', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ rating: 1 })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).resolves.toBeUndefined();
  });

  it('accepts rating at the upper boundary (7)', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ rating: 7 })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).resolves.toBeUndefined();
  });

  it('accepts partial answers — does not require every bundle question to have an answer', async () => {
    // Partial saves are intentional: the runner debounces save after each
    // change, so q2 not yet being answered must NOT block saving q1.
    const q2 = makeQuestion({ id: 'q2', sortOrder: 2 });
    const bundle = makeBundle({ questions: [makeQuestion(), q2] });
    const answers = [makeAnswer({ questionId: 'q1', rating: 4 })]; // q2 deliberately missing
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await uc.execute({ slug: 'ux-experience', bundle, answers });

    expect(repo.upsertAnswers).toHaveBeenCalledWith('ux-experience', answers);
  });

  it('throws SurveyError validation when an answer references a question_id not in the bundle', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ questionId: 'q-unknown', rating: 5 })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).rejects.toMatchObject({
      code: 'validation',
      detail: 'unknown_question_q-unknown',
    });
    expect(repo.upsertAnswers).not.toHaveBeenCalled();
  });

  it('throws SurveyError validation when rating is out of range (0)', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ rating: 0 })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('throws SurveyError validation when rating is out of range (8)', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ rating: 8 })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('propagates repo failure without wrapping', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ rating: 3 })];
    const repoErr = new Error('db write failed');
    const repo = makeFakeRepo({ upsertAnswers: vi.fn().mockRejectedValue(repoErr) });
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).rejects.toBe(repoErr);
  });

  it('accepts optional answerText as null', async () => {
    const bundle = makeBundle();
    const answers = [makeAnswer({ rating: 6, answerText: null })];
    const repo = makeFakeRepo();
    const uc = new SaveSurveyAnswersUseCase(repo);

    await expect(uc.execute({ slug: 'ux-experience', bundle, answers })).resolves.toBeUndefined();
  });

  describe('single-choice questions (KC#1058)', () => {
    const bundle = makeBundle({ questions: [makeChoiceQuestion(), makeQuestion()] });

    it('accepts one of the question options', async () => {
      const answers = [makeAnswer({ questionId: 'q-pmf', rating: null, choiceKey: 'very_disappointed' })];
      const repo = makeFakeRepo();

      await new SaveSurveyAnswersUseCase(repo).execute({ slug: 'pmf-sean-ellis', bundle, answers });

      expect(repo.upsertAnswers).toHaveBeenCalledWith('pmf-sean-ellis', answers);
    });

    it('rejects a key that is not an option', async () => {
      const answers = [makeAnswer({ questionId: 'q-pmf', rating: null, choiceKey: 'delighted' })];
      const repo = makeFakeRepo();

      await expect(
        new SaveSurveyAnswersUseCase(repo).execute({ slug: 'pmf-sean-ellis', bundle, answers }),
      ).rejects.toMatchObject({ code: 'validation', detail: 'invalid_choice_for_question_q-pmf' });
      expect(repo.upsertAnswers).not.toHaveBeenCalled();
    });

    it('rejects a rating on a single-choice question', async () => {
      const answers = [makeAnswer({ questionId: 'q-pmf', rating: 5, choiceKey: 'very_disappointed' })];

      await expect(
        new SaveSurveyAnswersUseCase(makeFakeRepo()).execute({ slug: 'pmf-sean-ellis', bundle, answers }),
      ).rejects.toMatchObject({ code: 'validation', detail: 'invalid_choice_for_question_q-pmf' });
    });

    it('rejects a choice key on a rating question', async () => {
      const answers = [makeAnswer({ questionId: 'q1', rating: null, choiceKey: 'very_disappointed' })];

      await expect(
        new SaveSurveyAnswersUseCase(makeFakeRepo()).execute({ slug: 'pmf-sean-ellis', bundle, answers }),
      ).rejects.toMatchObject({ code: 'validation', detail: 'invalid_rating_for_question_q1' });
    });
  });
});
