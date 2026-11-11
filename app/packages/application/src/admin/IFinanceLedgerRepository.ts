// V2-ADMIN-MONEY-9 — port for the admin finance ledger.
import type {
  FinanceDirection, FinanceEntryKind, FinanceEntryStatus, FinanceLedgerCursor, FinanceLedgerPage, FinanceSummaryRow,
} from '@kc/domain';

export interface FinanceLedgerListFilters {
  readonly direction?: FinanceDirection;
  readonly status?: FinanceEntryStatus;
  readonly fromDate?: Date;
  readonly toDate?: Date;
  readonly limit?: number;
  /** The `nextCursor` of the previous page; omit for the first page. */
  readonly after?: FinanceLedgerCursor;
}

export interface FinanceLedgerUpsertInput {
  readonly entryId?: string | null;
  readonly kind?: FinanceEntryKind;
  readonly amountCents?: number;
  readonly occurredAt?: Date;
  readonly counterparty?: string | null;
  readonly category?: string | null;
  readonly description?: string | null;
  readonly status?: FinanceEntryStatus;
  /** FR-FIN-003: omit to keep the current account on update. */
  readonly accountId?: string;
  /** FR-FIN-022: omit to keep the current visibility on update (new entries default to public). */
  readonly isPublic?: boolean;
}

export interface IFinanceLedgerRepository {
  list(filters: FinanceLedgerListFilters): Promise<FinanceLedgerPage>;
  summary(fromDate?: Date, toDate?: Date): Promise<readonly FinanceSummaryRow[]>;
  upsert(input: FinanceLedgerUpsertInput): Promise<string>;
  /** Takes the entry out of the books: it is voided (FR-FIN-005 AC2), never erased, and counts nowhere. */
  delete(entryId: string): Promise<void>;
}
