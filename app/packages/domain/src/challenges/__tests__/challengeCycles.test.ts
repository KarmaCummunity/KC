import { describe, expect, it } from 'vitest';
import { challengeCycleStart, isChallengeGoalMet, isValidIsoDate } from '../challengeCycles';

describe('challengeCycleStart', () => {
  it('treats every day as its own cycle for daily and flexible cadences', () => {
    expect(challengeCycleStart('2026-11-04', 'daily')).toBe('2026-11-04');
    expect(challengeCycleStart('2026-11-04', 'flexible')).toBe('2026-11-04');
  });

  it('snaps a weekly report to the Sunday that opened its week', () => {
    // 2026-11-04 is a Wednesday; the Israeli week started on Sunday 2026-11-01.
    expect(challengeCycleStart('2026-11-04', 'weekly')).toBe('2026-11-01');
    expect(challengeCycleStart('2026-11-01', 'weekly')).toBe('2026-11-01');
    expect(challengeCycleStart('2026-11-07', 'weekly')).toBe('2026-11-01');
  });

  it('crosses month and year boundaries', () => {
    expect(challengeCycleStart('2027-01-02', 'weekly')).toBe('2026-12-27');
  });

  it('rejects a malformed or impossible date', () => {
    expect(() => challengeCycleStart('2026-02-30', 'daily')).toThrow(RangeError);
    expect(() => challengeCycleStart('04/11/2026', 'daily')).toThrow(RangeError);
  });
});

describe('isValidIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-1-1')).toBe(false);
  });
});

describe('isChallengeGoalMet', () => {
  const countAtLeast = { measurement: 'count', goalValue: 10, goalDirection: 'at_least' } as const;
  const countAtMost = { measurement: 'count', goalValue: 5, goalDirection: 'at_most' } as const;

  it('requires a "yes" for yes/no challenges', () => {
    const yesNo = { measurement: 'yes_no', goalValue: null, goalDirection: null } as const;
    expect(isChallengeGoalMet(yesNo, 1)).toBe(true);
    expect(isChallengeGoalMet(yesNo, 0)).toBe(false);
  });

  it('meets an "at least" goal on the boundary and above', () => {
    expect(isChallengeGoalMet(countAtLeast, 10)).toBe(true);
    expect(isChallengeGoalMet(countAtLeast, 9.99)).toBe(false);
  });

  it('meets an "at most" goal on the boundary and below, including zero', () => {
    expect(isChallengeGoalMet(countAtMost, 5)).toBe(true);
    expect(isChallengeGoalMet(countAtMost, 0)).toBe(true);
    expect(isChallengeGoalMet(countAtMost, 6)).toBe(false);
  });

  it('counts any numeric report when the challenge has no goal', () => {
    const noGoal = { measurement: 'duration_minutes', goalValue: null, goalDirection: null } as const;
    expect(isChallengeGoalMet(noGoal, 0)).toBe(true);
  });
});
