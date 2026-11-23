// #2537 — formats an estimated salary for a job-offer card or detail line.
import {
  employmentSalaryAmounts,
  parseEmploymentJobOfferDetails,
  type EmploymentJobOfferDetails,
  type SalaryPayPeriod,
} from '@kc/domain';

type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatIls(amount: number): string {
  return Math.round(amount).toLocaleString('he-IL');
}

/** i18n key of a single amount or a range for the given pay period. */
function salaryKey(period: SalaryPayPeriod, isRange: boolean): string {
  if (period === 'pay_hourly') return isRange ? 'jobOffer.salary.rangeHourly' : 'jobOffer.salary.amountHourly';
  return isRange ? 'jobOffer.salary.rangeMonthly' : 'jobOffer.salary.amountMonthly';
}

/** Human-readable estimated salary from already-parsed job-offer details, or null. */
export function employmentSalaryLabelFromParsed(
  parsed: EmploymentJobOfferDetails,
  t: Translate,
): string | null {
  const amounts = employmentSalaryAmounts(parsed);
  if (!amounts || !parsed.payPeriod) return null;
  const isRange = amounts.max !== null && amounts.max !== amounts.min;
  if (isRange) {
    return t(salaryKey(parsed.payPeriod, true), {
      min: formatIls(amounts.min),
      max: formatIls(amounts.max!),
    });
  }
  return t(salaryKey(parsed.payPeriod, false), { amount: formatIls(amounts.min) });
}

/** Human-readable estimated salary from a listing's `details` document, or null. */
export function employmentSalaryLabel(
  details: Readonly<Record<string, unknown>>,
  t: Translate,
): string | null {
  return employmentSalaryLabelFromParsed(parseEmploymentJobOfferDetails(details), t);
}
