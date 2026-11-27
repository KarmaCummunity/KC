// #2537 — job-offer card lines for salary and requirements.
import { describe, expect, it } from 'vitest';
import { employmentCardDetails } from '../employmentCardDetails';

const t = (key: string) => key;

describe('employmentCardDetails', () => {
  it('is empty outside employment or without the new fields', () => {
    expect(employmentCardDetails('rides', { estimated_salary_min: 1, salary_pay_period: 'pay_hourly' }, t)).toEqual([]);
    expect(employmentCardDetails('employment', {}, t)).toEqual([]);
    expect(employmentCardDetails('employment', null, t)).toEqual([]);
  });

  it('lists salary then a shortened requirements line', () => {
    const long = 'a'.repeat(100);
    const lines = employmentCardDetails(
      'employment',
      {
        job_requirements: long,
        estimated_salary_min: 10000,
        salary_pay_period: 'pay_monthly',
      },
      t,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.icon).toBe('cash-outline');
    expect(lines[1]?.text.endsWith('…')).toBe(true);
    expect(lines[1]?.text.length).toBe(80);
  });
});
