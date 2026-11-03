// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { saveSurveyAnswers: { execute } } }));
import { useSurveyRunnerState } from '../useSurveyRunnerState';

const bundle = {
  version: 2,
  questions: [{ id: 'q1' }, { id: 'q2' }],
  answers: [{ questionId: 'q1', rating: 3, choiceKey: null, answerText: null }],
} as never;

beforeEach(() => {
  vi.useRealTimers();
  execute.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe('useSurveyRunnerState', () => {
  it('hydrates server answers, overlays a draft and clamps its active index', async () => {
    window.localStorage.setItem('kc-survey-draft-form', JSON.stringify({
      version: 2,
      activeIndex: 9,
      answers: { q1: { rating: null, answerText: 'draft' }, q2: { choiceKey: 'yes' } },
      savedAt: Date.now(),
    }));
    const { result } = renderHook(() => useSurveyRunnerState(bundle, 'form'));
    await waitFor(() => expect(result.current.activeIndex).toBe(1));
    expect(result.current.answers).toEqual({
      q1: { rating: null, choiceKey: null, answerText: 'draft' },
      q2: { rating: null, choiceKey: 'yes', answerText: null },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not hydrate until a bundle arrives and persists text-only edits locally', async () => {
    const { result, rerender } = renderHook(({ value }) => useSurveyRunnerState(value, 'form'), {
      initialProps: { value: null as never },
    });
    expect(result.current.answers).toEqual({});
    rerender({ value: bundle });
    await waitFor(() => expect(result.current.answers.q1).toBeDefined());
    act(() => result.current.onAnswerChange('q2', { rating: null, choiceKey: null, answerText: 'only text' }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('kc-survey-draft-form') ?? '{}').answers.q2.answerText).toBe('only text'));
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(300));
    expect(execute).not.toHaveBeenCalled();
  });

  it('debounces value answers, saves the latest edit, and exposes save errors', async () => {
    vi.useFakeTimers();
    execute.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSurveyRunnerState(bundle, 'form'));
    act(() => {
      result.current.onAnswerChange('q1', { rating: 4, choiceKey: null, answerText: null });
      result.current.onAnswerChange('q2', { rating: null, choiceKey: 'yes', answerText: 'note' });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.saveErrorOpen).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      slug: 'form', bundle,
      answers: [
        { questionId: 'q1', rating: 4, choiceKey: null, answerText: null },
        { questionId: 'q2', rating: null, choiceKey: 'yes', answerText: 'note' },
      ],
    });
    act(() => result.current.setSaveErrorOpen(false));
    expect(result.current.saveErrorOpen).toBe(false);
  });
});
