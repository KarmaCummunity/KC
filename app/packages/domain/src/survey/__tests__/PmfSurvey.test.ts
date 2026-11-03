import { describe, expect, it } from 'vitest';
import {
  PMF_MIN_RELIABLE_SAMPLE,
  marginOfError95,
  summarizePmfSurvey,
  type PmfSurveyReport,
} from '../PmfSurvey';
import { hasSurveyAnswerValue } from '../SurveyTypes';

function report(
  counts: { very: number; somewhat: number; not: number },
  retention: { base: number; retained: number } = { base: 0, retained: 0 },
): PmfSurveyReport {
  const n = counts.very + counts.somewhat + counts.not;
  return {
    slug: 'pmf-sean-ellis',
    titleHe: 'title',
    version: 1,
    promptHe: 'prompt',
    minActiveDays14d: 2,
    respondentsTotal: n + 3,
    respondentsQualified: n,
    options: [
      { key: 'very_disappointed', labelHe: 'very', count: counts.very, retentionBase: retention.base, retained: retention.retained },
      { key: 'somewhat_disappointed', labelHe: 'somewhat', count: counts.somewhat, retentionBase: 0, retained: 0 },
      { key: 'not_disappointed', labelHe: 'not', count: counts.not, retentionBase: 0, retained: 0 },
    ],
  };
}

describe('summarizePmfSurvey', () => {
  it('derives the share, the 95% margin of error and the benchmark from qualified counts', () => {
    const summary = summarizePmfSurvey(report({ very: 40, somewhat: 35, not: 25 }));
    expect(summary.sampleSize).toBe(100);
    expect(summary.veryDisappointedShare).toBeCloseTo(0.4);
    // 1.96 · √(0.4 · 0.6 / 100) ≈ 0.0960
    expect(summary.marginOfError95).toBeCloseTo(0.096, 3);
    expect(summary.meetsBenchmark).toBe(true);
    expect(summary.isReliableSample).toBe(true);
    expect(summary.options.map((o) => o.share)).toEqual([0.4, 0.35, 0.25]);
  });

  it('marks a share just under 40% as below the benchmark', () => {
    expect(summarizePmfSurvey(report({ very: 39, somewhat: 31, not: 30 })).meetsBenchmark).toBe(false);
  });

  it('flags a sample under the reliability threshold', () => {
    const summary = summarizePmfSurvey(report({ very: 10, somewhat: 10, not: PMF_MIN_RELIABLE_SAMPLE - 21 }));
    expect(summary.sampleSize).toBe(PMF_MIN_RELIABLE_SAMPLE - 1);
    expect(summary.isReliableSample).toBe(false);
  });

  it('returns nulls instead of fake zeros when nobody qualified', () => {
    const summary = summarizePmfSurvey(report({ very: 0, somewhat: 0, not: 0 }));
    expect(summary.veryDisappointedShare).toBeNull();
    expect(summary.marginOfError95).toBeNull();
    expect(summary.meetsBenchmark).toBeNull();
    expect(summary.options.every((o) => o.share === null && o.retentionRate === null)).toBe(true);
  });

  it('computes retention only over respondents whose retention is measurable', () => {
    const summary = summarizePmfSurvey(report({ very: 5, somewhat: 0, not: 0 }, { base: 4, retained: 3 }));
    expect(summary.options[0]?.retentionRate).toBe(0.75);
    expect(summary.options[1]?.retentionRate).toBeNull();
  });
});

describe('marginOfError95', () => {
  it('is widest at p = 0.5 and shrinks with √n', () => {
    expect(marginOfError95(0.5, 100)).toBeCloseTo(0.098, 3);
    expect(marginOfError95(0.5, 400)).toBeCloseTo(0.049, 3);
  });
});

describe('hasSurveyAnswerValue', () => {
  it('accepts a rating or a choice and rejects an empty answer', () => {
    expect(hasSurveyAnswerValue({ rating: 4, choiceKey: null })).toBe(true);
    expect(hasSurveyAnswerValue({ rating: null, choiceKey: 'very_disappointed' })).toBe(true);
    expect(hasSurveyAnswerValue({ rating: null, choiceKey: null })).toBe(false);
    expect(hasSurveyAnswerValue(undefined)).toBe(false);
  });
});
