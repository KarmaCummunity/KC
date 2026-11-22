// #2537 — job-offer requirements and estimated salary: parse, validate and amount pairing.
import { describe, expect, it } from 'vitest';
import {
  ESTIMATED_SALARY_MAX_ILS,
  employmentSalaryAmounts,
  hasEmploymentSalaryInput,
  isSalaryPayPeriod,
  parseEmploymentJobOfferDetails,
  validateEmploymentSalary,
} from '../employmentJobOffer';

describe('employmentJobOffer (#2537)', () => {
  it('parses requirements and an optional salary range with a pay period', () => {
    expect(
      parseEmploymentJobOfferDetails({
        job_requirements: '  3 years TypeScript  ',
        estimated_salary_min: 12000,
        estimated_salary_max: 15000,
        salary_pay_period: 'pay_monthly',
      }),
    ).toEqual({
      requirements: '3 years TypeScript',
      salaryMin: 12000,
      salaryMax: 15000,
      payPeriod: 'pay_monthly',
    });
  });

  it('treats blank and unknown salary values as absent', () => {
    expect(parseEmploymentJobOfferDetails({ job_requirements: '  ', salary_pay_period: 'weekly' })).toEqual({
      requirements: null,
      salaryMin: null,
      salaryMax: null,
      payPeriod: null,
    });
    expect(isSalaryPayPeriod('pay_hourly')).toBe(true);
    expect(isSalaryPayPeriod('hourly')).toBe(false);
  });

  it('accepts an empty salary and a single amount with its period', () => {
    expect(validateEmploymentSalary({})).toBeNull();
    expect(validateEmploymentSalary({ estimated_salary_min: 80, salary_pay_period: 'pay_hourly' })).toBeNull();
    expect(
      validateEmploymentSalary({
        estimated_salary_min: 10000,
        estimated_salary_max: 12000,
        salary_pay_period: 'pay_monthly',
      }),
    ).toBeNull();
  });

  it('requires the period with an amount and an amount with the period', () => {
    expect(validateEmploymentSalary({ estimated_salary_min: 100 })).toBe('salary_period_required');
    expect(validateEmploymentSalary({ salary_pay_period: 'pay_monthly' })).toBe('salary_amount_required');
    expect(hasEmploymentSalaryInput({ estimated_salary_max: 1 })).toBe(true);
    expect(hasEmploymentSalaryInput({})).toBe(false);
  });

  it('rejects an inverted range and amounts outside the cap', () => {
    expect(
      validateEmploymentSalary({
        estimated_salary_min: 20,
        estimated_salary_max: 10,
        salary_pay_period: 'pay_hourly',
      }),
    ).toBe('salary_range_inverted');
    expect(
      validateEmploymentSalary({
        estimated_salary_min: ESTIMATED_SALARY_MAX_ILS + 1,
        salary_pay_period: 'pay_monthly',
      }),
    ).toBe('salary_out_of_range');
  });

  it('pairs a lone min or max as the display amount', () => {
    expect(employmentSalaryAmounts(parseEmploymentJobOfferDetails({ estimated_salary_min: 50 }))).toEqual({
      min: 50,
      max: null,
    });
    expect(employmentSalaryAmounts(parseEmploymentJobOfferDetails({ estimated_salary_max: 90 }))).toEqual({
      min: 90,
      max: null,
    });
    expect(employmentSalaryAmounts(parseEmploymentJobOfferDetails({}))).toBeNull();
  });
});
