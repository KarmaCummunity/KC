import { describe, expect, it } from 'vitest';
import {
  FINANCE_ACCOUNT_KINDS,
  FINANCE_ACCOUNT_LAST4_RE,
  parseFinanceAccountKind,
} from '../FinanceAccount';
import {
  FINANCE_EXPENSE_CATEGORIES,
  FINANCE_INCOME_CATEGORIES,
  PROGRAM_EXPENSE_CATEGORY,
  categoriesForDirection,
  isFinanceCategoryKey,
} from '../FinanceCategory';
import {
  DEFAULT_TRANSPARENCY_SETTINGS,
  HIDDEN_TRANSPARENCY,
  TRANSPARENCY_TOGGLES,
  hasAnyTransparencyToggle,
  isTransparencyToggle,
} from '../FinanceTransparency';

describe('parseFinanceAccountKind', () => {
  it.each(FINANCE_ACCOUNT_KINDS)('accepts canonical kind "%s"', (k) => {
    expect(parseFinanceAccountKind(k)).toBe(k);
  });

  it('rejects unknown and nullish values', () => {
    expect(parseFinanceAccountKind('crypto')).toBeNull();
    expect(parseFinanceAccountKind(null)).toBeNull();
    expect(parseFinanceAccountKind(undefined)).toBeNull();
  });
});

describe('FINANCE_ACCOUNT_LAST4_RE', () => {
  it('accepts exactly four digits', () => {
    expect(FINANCE_ACCOUNT_LAST4_RE.test('0042')).toBe(true);
  });

  it.each(['', '123', '12345', '12a4', ' 123'])('rejects "%s"', (v) => {
    expect(FINANCE_ACCOUNT_LAST4_RE.test(v)).toBe(false);
  });
});

describe('finance categories', () => {
  it('picks the list by direction', () => {
    expect(categoriesForDirection('in')).toBe(FINANCE_INCOME_CATEGORIES);
    expect(categoriesForDirection('out')).toBe(FINANCE_EXPENSE_CATEGORIES);
  });

  it('keeps income and expense keys disjoint', () => {
    const overlap = FINANCE_INCOME_CATEGORIES.filter((k) =>
      (FINANCE_EXPENSE_CATEGORIES as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });

  it('program category is a known expense key (the server ratio relies on it)', () => {
    expect(FINANCE_EXPENSE_CATEGORIES).toContain(PROGRAM_EXPENSE_CATEGORY);
    expect(FINANCE_EXPENSE_CATEGORIES).toContain('other_out');
  });

  it('recognises keys and rejects free text / nullish', () => {
    expect(isFinanceCategoryKey('program')).toBe(true);
    expect(isFinanceCategoryKey('grants')).toBe(true);
    expect(isFinanceCategoryKey('my custom label')).toBe(false);
    expect(isFinanceCategoryKey(null)).toBe(false);
    expect(isFinanceCategoryKey(undefined)).toBe(false);
  });
});

describe('transparency settings', () => {
  it('defaults every toggle to off', () => {
    expect(TRANSPARENCY_TOGGLES.every((t) => DEFAULT_TRANSPARENCY_SETTINGS[t] === false)).toBe(true);
    expect(hasAnyTransparencyToggle(DEFAULT_TRANSPARENCY_SETTINGS)).toBe(false);
  });

  it('detects a single enabled toggle', () => {
    expect(hasAnyTransparencyToggle({ ...DEFAULT_TRANSPARENCY_SETTINGS, show_monthly_trend: true })).toBe(true);
  });

  it('recognises toggle names only', () => {
    expect(isTransparencyToggle('show_totals')).toBe(true);
    expect(isTransparencyToggle('show_donor_names')).toBe(false);
  });
});

describe('OrgTransparency payload shape (FR-FIN-019 AC6)', () => {
  it('exposes exactly the aggregate fields — nothing that could carry donor identity or entry-level data', () => {
    // An allow-list, so adding any new field (e.g. a donor name) forces a deliberate test change.
    expect(Object.keys(HIDDEN_TRANSPARENCY).sort()).toEqual([
      'byCategory', 'currency', 'donationsCount', 'enabled',
      'lastEntryAt', 'monthly', 'programRatio', 'totals',
    ]);
  });

  it('the hidden payload exposes nothing', () => {
    expect(HIDDEN_TRANSPARENCY.enabled).toBe(false);
    expect(HIDDEN_TRANSPARENCY.totals).toBeNull();
    expect(HIDDEN_TRANSPARENCY.byCategory).toBeNull();
    expect(HIDDEN_TRANSPARENCY.monthly).toBeNull();
  });
});
