import { describe, expect, it } from 'vitest';
import { ChallengeError, type ChallengeErrorCode } from '../ChallengeError';
import type { ChallengeDraft, ChallengeProgressInput } from '../ChallengeTypes';
import { validateChallengeDraft, validateChallengeProgress } from '../validateChallenge';

const validDraft: ChallengeDraft = {
  title: '10,000 steps a day',
  description: null,
  scope: 'community',
  measurement: 'count',
  cadence: 'daily',
  goalValue: 10000,
  goalDirection: 'at_least',
  difficulty: 'medium',
  topicLabel: 'health',
  endsAt: null,
  targetCycles: 30,
};

function codeOfDraft(overrides: Partial<ChallengeDraft>): ChallengeErrorCode | null {
  try {
    validateChallengeDraft({ ...validDraft, ...overrides });
    return null;
  } catch (error) {
    if (error instanceof ChallengeError) return error.code;
    throw error;
  }
}

describe('validateChallengeDraft', () => {
  it('accepts a complete draft and a minimal yes/no draft', () => {
    expect(codeOfDraft({})).toBeNull();
    expect(
      codeOfDraft({ measurement: 'yes_no', goalValue: null, goalDirection: null, difficulty: null, targetCycles: null }),
    ).toBeNull();
  });

  it('bounds the title by its trimmed length', () => {
    expect(codeOfDraft({ title: '  ab  ' })).toBe('title_too_short');
    expect(codeOfDraft({ title: 'x'.repeat(81) })).toBe('title_too_long');
    expect(codeOfDraft({ title: 'x'.repeat(80) })).toBeNull();
  });

  it('bounds description and topic', () => {
    expect(codeOfDraft({ description: 'x'.repeat(2001) })).toBe('description_too_long');
    expect(codeOfDraft({ topicLabel: 'x'.repeat(51) })).toBe('topic_too_long');
  });

  it('rejects unknown enum values', () => {
    expect(codeOfDraft({ scope: 'group' as never })).toBe('invalid_scope');
    expect(codeOfDraft({ measurement: 'weight' as never })).toBe('invalid_measurement');
    expect(codeOfDraft({ cadence: 'monthly' as never })).toBe('invalid_cadence');
    expect(codeOfDraft({ difficulty: 'insane' as never })).toBe('invalid_difficulty');
  });

  it('forbids a goal on a yes/no challenge', () => {
    expect(codeOfDraft({ measurement: 'yes_no' })).toBe('goal_not_allowed_for_yes_no');
  });

  it('requires a goal value and direction together', () => {
    expect(codeOfDraft({ goalValue: null })).toBe('goal_direction_without_goal');
    expect(codeOfDraft({ goalDirection: null })).toBe('goal_direction_required');
  });

  it('validates the goal value range, and that "at least 0" is no goal', () => {
    expect(codeOfDraft({ goalValue: -1 })).toBe('goal_value_invalid');
    expect(codeOfDraft({ goalValue: Number.NaN })).toBe('goal_value_invalid');
    expect(codeOfDraft({ goalValue: 0 })).toBe('goal_value_invalid');
    expect(codeOfDraft({ goalValue: 0, goalDirection: 'at_most' })).toBeNull();
  });

  it('validates target cycles and the end timestamp', () => {
    expect(codeOfDraft({ targetCycles: 0 })).toBe('target_cycles_invalid');
    expect(codeOfDraft({ targetCycles: 367 })).toBe('target_cycles_invalid');
    expect(codeOfDraft({ targetCycles: 1.5 })).toBe('target_cycles_invalid');
    expect(codeOfDraft({ endsAt: 'tomorrow-ish' })).toBe('ends_at_invalid');
    expect(codeOfDraft({ endsAt: '2027-01-01T00:00:00Z' })).toBeNull();
  });
});

const validProgress: ChallengeProgressInput = {
  challengeId: 'c1',
  measurement: 'count',
  value: 3,
  note: null,
  reportDate: null,
};

function codeOfProgress(overrides: Partial<ChallengeProgressInput>): ChallengeErrorCode | null {
  try {
    validateChallengeProgress({ ...validProgress, ...overrides });
    return null;
  } catch (error) {
    if (error instanceof ChallengeError) return error.code;
    throw error;
  }
}

describe('validateChallengeProgress', () => {
  it('accepts a normal report, a zero count and a dated report', () => {
    expect(codeOfProgress({})).toBeNull();
    expect(codeOfProgress({ value: 0 })).toBeNull();
    expect(codeOfProgress({ reportDate: '2026-11-03' })).toBeNull();
  });

  it('rejects negative, non-finite and oversized values', () => {
    expect(codeOfProgress({ value: -1 })).toBe('value_invalid');
    expect(codeOfProgress({ value: Number.POSITIVE_INFINITY })).toBe('value_invalid');
    expect(codeOfProgress({ value: 100_000_000 })).toBe('value_invalid');
  });

  it('accepts only 0 or 1 for a yes/no report', () => {
    expect(codeOfProgress({ measurement: 'yes_no', value: 1 })).toBeNull();
    expect(codeOfProgress({ measurement: 'yes_no', value: 2 })).toBe('yes_no_value_invalid');
  });

  it('bounds the note and checks the date format', () => {
    expect(codeOfProgress({ note: 'x'.repeat(501) })).toBe('note_too_long');
    expect(codeOfProgress({ reportDate: '3/11/2026' })).toBe('report_date_invalid');
  });
});
