// #2537 — estimated salary label for cards and detail.
import { describe, expect, it } from 'vitest';
import { employmentSalaryLabel } from '../employmentSalaryLabel';

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}:${JSON.stringify(options ?? {})}`;

describe('employmentSalaryLabel', () => {
  it('returns null when there is no amount or period', () => {
    expect(employmentSalaryLabel({}, t)).toBeNull();
    expect(employmentSalaryLabel({ estimated_salary_min: 100 }, t)).toBeNull();
  });

  it('formats a single monthly amount and an hourly range', () => {
    expect(
      employmentSalaryLabel({ estimated_salary_min: 12000, salary_pay_period: 'pay_monthly' }, t),
    ).toContain('jobOffer.salary.amountMonthly');
    expect(
      employmentSalaryLabel(
        { estimated_salary_min: 80, estimated_salary_max: 120, salary_pay_period: 'pay_hourly' },
        t,
      ),
    ).toContain('jobOffer.salary.rangeHourly');
  });
});
