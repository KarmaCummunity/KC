import { describe, expect, it } from 'vitest';
import { composeIsoDate, dateOfBirthIssue, latestAllowedBirthDate, parseIsoDate } from '../dateOfBirth';

const NOW = new Date(2026, 10, 3, 12, 0, 0); // 3 Nov 2026, local time

describe('composeIsoDate', () => {
  it('builds a padded ISO date', () => {
    expect(composeIsoDate(5, 3, 1990)).toBe('1990-03-05');
  });
  it('rejects dates that do not exist', () => {
    expect(composeIsoDate(31, 4, 1990)).toBeNull();
    expect(composeIsoDate(29, 2, 2001)).toBeNull();
    expect(composeIsoDate(0, 1, 1990)).toBeNull();
    expect(composeIsoDate(1, 13, 1990)).toBeNull();
    expect(composeIsoDate(1.5, 1, 1990)).toBeNull();
    expect(composeIsoDate(1, 1, 90)).toBeNull();
  });
  it('accepts 29 February in a leap year', () => {
    expect(composeIsoDate(29, 2, 2000)).toBe('2000-02-29');
  });
});

describe('parseIsoDate', () => {
  it('reads a real ISO date', () => {
    expect(parseIsoDate('1990-03-05')).toEqual([1990, 3, 5]);
  });
  it('rejects malformed or impossible text', () => {
    for (const bad of ['', '1990-3-5', '1990-02-30', 'abc', '1990-03-05T00:00:00Z']) {
      expect(parseIsoDate(bad)).toBeNull();
    }
  });
});

describe('dateOfBirthIssue (18+)', () => {
  it('accepts exactly 18 today and older', () => {
    expect(latestAllowedBirthDate(NOW)).toBe('2008-11-03');
    expect(dateOfBirthIssue('2008-11-03', NOW)).toBeNull();
    expect(dateOfBirthIssue('1985-06-15', NOW)).toBeNull();
  });
  it('rejects one day short of 18 as underage', () => {
    expect(dateOfBirthIssue('2008-11-04', NOW)).toBe('underage');
    expect(dateOfBirthIssue('2015-01-01', NOW)).toBe('underage');
  });
  it('rejects future, pre-1900 and unreal dates as invalid', () => {
    expect(dateOfBirthIssue('2026-11-04', NOW)).toBe('invalid_date_of_birth');
    expect(dateOfBirthIssue('1899-12-31', NOW)).toBe('invalid_date_of_birth');
    expect(dateOfBirthIssue('2001-02-29', NOW)).toBe('invalid_date_of_birth');
    expect(dateOfBirthIssue('nonsense', NOW)).toBe('invalid_date_of_birth');
  });
  it('counts a 29 February today as 18 years from 28 February in a non-leap year', () => {
    const leapDay = new Date(2028, 1, 29); // 29 Feb 2028 -> 18 years ago is 29 Feb 2010 (not a date)
    expect(latestAllowedBirthDate(leapDay)).toBe('2010-02-28');
  });
});
