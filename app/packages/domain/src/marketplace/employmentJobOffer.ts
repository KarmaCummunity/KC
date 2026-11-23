// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (employment) · #2537.
// Job-offer details beyond role / scope / where: free-text requirements and an optional
// estimated salary (single amount or range) with an hourly or monthly pay period.

/** Cap on a typed estimated salary (ILS). Catches typos; nonprofit roles stay far below it. */
export const ESTIMATED_SALARY_MAX_ILS = 500_000;

/** Max length of the free-text job requirements field. */
export const JOB_REQUIREMENTS_MAX_LENGTH = 2000;

/** Pay periods offered with an estimated salary (`marketplace.option` keys). */
export const SALARY_PAY_PERIODS = ['pay_hourly', 'pay_monthly'] as const;
export type SalaryPayPeriod = (typeof SALARY_PAY_PERIODS)[number];

/** Why a job offer's salary fields cannot be published. */
export type EmploymentSalaryErrorCode =
  | 'salary_period_required'
  | 'salary_amount_required'
  | 'salary_range_inverted'
  | 'salary_out_of_range';

/** The employment fields of a job offer's `posts.details`, parsed for display and cards. */
export interface EmploymentJobOfferDetails {
  readonly requirements: string | null;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly payPeriod: SalaryPayPeriod | null;
}

/** Type guard: is `value` an hourly or monthly pay period? */
export function isSalaryPayPeriod(value: unknown): value is SalaryPayPeriod {
  return typeof value === 'string' && (SALARY_PAY_PERIODS as readonly string[]).includes(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads the job-offer fields of a listing's details. Empty when none of the #2537 fields are
 * present (an older job offer, or a job request).
 */
export function parseEmploymentJobOfferDetails(
  details: Readonly<Record<string, unknown>>,
): EmploymentJobOfferDetails {
  return {
    requirements: optionalText(details.job_requirements),
    salaryMin: optionalAmount(details.estimated_salary_min),
    salaryMax: optionalAmount(details.estimated_salary_max),
    payPeriod: isSalaryPayPeriod(details.salary_pay_period) ? details.salary_pay_period : null,
  };
}

/** True when the details carry any of the optional salary inputs. */
export function hasEmploymentSalaryInput(details: Readonly<Record<string, unknown>>): boolean {
  const { salaryMin, salaryMax, payPeriod } = parseEmploymentJobOfferDetails(details);
  return salaryMin !== null || salaryMax !== null || payPeriod !== null;
}

/**
 * Validates the optional estimated salary of a job offer. Null when valid or when every salary
 * field is empty. A period needs an amount, an amount needs a period, and a range must be ordered.
 */
export function validateEmploymentSalary(
  details: Readonly<Record<string, unknown>>,
): EmploymentSalaryErrorCode | null {
  const { salaryMin, salaryMax, payPeriod } = parseEmploymentJobOfferDetails(details);
  const hasAmount = salaryMin !== null || salaryMax !== null;
  if (!hasAmount && payPeriod === null) return null;
  if (hasAmount && payPeriod === null) return 'salary_period_required';
  if (!hasAmount && payPeriod !== null) return 'salary_amount_required';
  for (const amount of [salaryMin, salaryMax]) {
    if (amount !== null && (amount < 0 || amount > ESTIMATED_SALARY_MAX_ILS)) return 'salary_out_of_range';
  }
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) return 'salary_range_inverted';
  return null;
}

/**
 * The single amount or the ordered [min, max] pair used for display. A lone max is treated as the
 * amount (conservative: the form labels min as the primary field).
 */
export function employmentSalaryAmounts(
  details: EmploymentJobOfferDetails,
): { readonly min: number; readonly max: number | null } | null {
  if (details.salaryMin !== null) {
    return { min: details.salaryMin, max: details.salaryMax };
  }
  if (details.salaryMax !== null) return { min: details.salaryMax, max: null };
  return null;
}
