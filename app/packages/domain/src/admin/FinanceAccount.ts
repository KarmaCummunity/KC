// FR-FIN-003 (lean) — financial accounts: where the organisation's money physically sits.

export const FINANCE_ACCOUNT_KINDS = [
  'bank',
  'cash',
  'bit',
  'paybox',
  'payment_provider',
  'other',
] as const;
export type FinanceAccountKind = (typeof FINANCE_ACCOUNT_KINDS)[number];

export const FINANCE_ACCOUNT_NAME_MAX = 80;

/** Bank accounts may carry the last four digits for recognition (never the full number). */
export const FINANCE_ACCOUNT_LAST4_RE = /^\d{4}$/;

export function parseFinanceAccountKind(v: string | null | undefined): FinanceAccountKind | null {
  if (v == null) return null;
  return (FINANCE_ACCOUNT_KINDS as readonly string[]).includes(v)
    ? (v as FinanceAccountKind)
    : null;
}

export interface FinanceAccount {
  readonly accountId: string;
  readonly name: string;
  readonly kind: FinanceAccountKind;
  readonly last4: string | null;
  readonly openingBalanceCents: number;
  readonly openingBalanceAt: Date | null;
  readonly isActive: boolean;
  readonly sortOrder: number;
  /** Opening balance + cleared inflows − cleared outflows (computed by the server). */
  readonly balanceCents: number;
  /** Entries booked on the account; null when the server does not report it. */
  readonly entryCount: number | null;
}
