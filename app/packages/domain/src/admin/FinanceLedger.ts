// V2-ADMIN-MONEY-9 — finance ledger domain types.

export const FINANCE_ENTRY_KINDS = [
  'donation_in',
  'grant_in',
  'expense',
  'refund_out',
  'transfer',
] as const;
export type FinanceEntryKind = (typeof FINANCE_ENTRY_KINDS)[number];

export const FINANCE_ENTRY_STATUSES = ['pending', 'cleared', 'cancelled'] as const;
export type FinanceEntryStatus = (typeof FINANCE_ENTRY_STATUSES)[number];

export type FinanceDirection = 'in' | 'out';

export function directionOfKind(kind: FinanceEntryKind): FinanceDirection | null {
  if (kind === 'donation_in' || kind === 'grant_in') return 'in';
  if (kind === 'expense'     || kind === 'refund_out') return 'out';
  return null; // transfer
}

export function parseFinanceEntryKind(v: string | null | undefined): FinanceEntryKind | null {
  if (v == null) return null;
  return (FINANCE_ENTRY_KINDS as readonly string[]).includes(v)
    ? (v as FinanceEntryKind)
    : null;
}
export function parseFinanceEntryStatus(v: string | null | undefined): FinanceEntryStatus | null {
  if (v == null) return null;
  return (FINANCE_ENTRY_STATUSES as readonly string[]).includes(v)
    ? (v as FinanceEntryStatus)
    : null;
}

export interface FinanceEntry {
  readonly entryId: string;
  readonly kind: FinanceEntryKind;
  readonly direction: FinanceDirection;
  readonly amountCents: number;
  readonly currency: string;
  readonly occurredAt: Date;
  readonly counterparty: string | null;
  readonly category: string | null;
  readonly description: string | null;
  readonly status: FinanceEntryStatus;
  /** FR-FIN-003: the financial account the money moved through; null for legacy entries. */
  readonly accountId: string | null;
  /** FR-FIN-022: false excludes the entry from the public transparency aggregates. */
  readonly isPublic: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Keyset position after an entry: the list is ordered by occurrence time, then id, newest first. */
export interface FinanceLedgerCursor {
  readonly occurredAt: Date;
  readonly entryId: string;
}

export interface FinanceLedgerPage {
  readonly rows: readonly FinanceEntry[];
  /** Where the next page starts; null on the last page. */
  readonly nextCursor: FinanceLedgerCursor | null;
}

export interface FinanceSummaryRow {
  readonly currency: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
  readonly entryCount: number;
}

export type FinanceLedgerErrorCode =
  | 'forbidden'
  | 'invalid_kind'
  | 'invalid_status'
  | 'invalid_amount'
  | 'invalid_direction'
  | 'missing_required_fields'
  | 'entry_not_found'
  | 'account_not_found'
  | 'account_name_taken'
  | 'invalid_name'
  | 'invalid_last4'
  | 'invalid_settings'
  | 'org_not_found'
  /** A void needs the admin's reason, 3 to 500 characters (FR-FIN-005 AC2). */
  | 'void_reason_required'
  | 'unknown';

/** Shortest and longest reason of a voided entry, after trimming (FR-FIN-005 AC2). */
export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 500;

/** Whether `reason` may void an entry: 3 to 500 characters once trimmed. */
export function isValidVoidReason(reason: string): boolean {
  const length = reason.trim().length;
  return length >= VOID_REASON_MIN && length <= VOID_REASON_MAX;
}

export class FinanceLedgerError extends Error {
  constructor(public readonly code: FinanceLedgerErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'FinanceLedgerError';
  }
}

export function isFinanceLedgerError(value: unknown): value is FinanceLedgerError {
  return value instanceof FinanceLedgerError;
}
