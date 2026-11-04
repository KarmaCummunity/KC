// FR-FIN-004 AC1 (lean) — default ledger categories.
//
// Entries store the stable KEY in `finance_ledger_entries.category`; the UI maps a key
// to its localized label and shows unknown free text as typed. The expense keys are
// mirrored by `rpc_org_transparency` (migration 0470), which folds any other value into
// 'other_out' so the public breakdown never exposes free-text labels.

import type { FinanceDirection } from './FinanceLedger';

export const FINANCE_INCOME_CATEGORIES = [
  'individual_donations',
  'corporate_donations',
  'standing_orders',
  'grants',
  'other_in',
] as const;

export const FINANCE_EXPENSE_CATEGORIES = [
  'program',
  'payroll',
  'rent_ops',
  'marketing_fundraising',
  'admin_general',
  'fees',
  'donor_refunds',
  'other_out',
] as const;

export type FinanceIncomeCategory = (typeof FINANCE_INCOME_CATEGORIES)[number];
export type FinanceExpenseCategory = (typeof FINANCE_EXPENSE_CATEGORIES)[number];
export type FinanceCategoryKey = FinanceIncomeCategory | FinanceExpenseCategory;

/** Expenses in this category count as "program spend" in the public program ratio. */
export const PROGRAM_EXPENSE_CATEGORY: FinanceExpenseCategory = 'program';

export function categoriesForDirection(direction: FinanceDirection): readonly FinanceCategoryKey[] {
  return direction === 'in' ? FINANCE_INCOME_CATEGORIES : FINANCE_EXPENSE_CATEGORIES;
}

export function isFinanceCategoryKey(value: string | null | undefined): value is FinanceCategoryKey {
  if (value == null) return false;
  return (
    (FINANCE_INCOME_CATEGORIES as readonly string[]).includes(value) ||
    (FINANCE_EXPENSE_CATEGORIES as readonly string[]).includes(value)
  );
}
