// FR-FIN-022 — live public transparency, controlled per organisation.
//
// Every toggle defaults to OFF. The public payload carries aggregates only: it has no field
// for counterparties, entry ids or account names, so donor identities cannot leak by design
// (FR-FIN-019 AC6).

export const TRANSPARENCY_TOGGLES = [
  'show_totals',
  'show_program_ratio',
  'show_category_breakdown',
  'show_monthly_trend',
  'show_donations_count',
] as const;
export type TransparencyToggle = (typeof TRANSPARENCY_TOGGLES)[number];

export type TransparencySettings = Readonly<Record<TransparencyToggle, boolean>>;

export const DEFAULT_TRANSPARENCY_SETTINGS: TransparencySettings = {
  show_totals: false,
  show_program_ratio: false,
  show_category_breakdown: false,
  show_monthly_trend: false,
  show_donations_count: false,
};

export function isTransparencyToggle(value: string): value is TransparencyToggle {
  return (TRANSPARENCY_TOGGLES as readonly string[]).includes(value);
}

/** True when at least one block is switched on, i.e. the public section can render. */
export function hasAnyTransparencyToggle(settings: TransparencySettings): boolean {
  return TRANSPARENCY_TOGGLES.some((t) => settings[t]);
}

export interface TransparencyTotals {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
}

export interface TransparencyCategoryShare {
  /** A FinanceExpenseCategory key; the server folds unknown labels into 'other_out'. */
  readonly key: string;
  readonly cents: number;
}

export interface TransparencyMonth {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
}

/** Each block is null when its toggle is off (or, for the ratio, when there are no expenses). */
export interface OrgTransparency {
  readonly enabled: boolean;
  readonly currency: string;
  readonly lastEntryAt: Date | null;
  readonly totals: TransparencyTotals | null;
  readonly donationsCount: number | null;
  /** Program expenses ÷ all expenses, 0..1. */
  readonly programRatio: number | null;
  readonly byCategory: readonly TransparencyCategoryShare[] | null;
  readonly monthly: readonly TransparencyMonth[] | null;
}

/** What a viewer gets when nothing is published. */
export const HIDDEN_TRANSPARENCY: OrgTransparency = {
  enabled: false,
  currency: 'ILS',
  lastEntryAt: null,
  totals: null,
  donationsCount: null,
  programRatio: null,
  byCategory: null,
  monthly: null,
};
