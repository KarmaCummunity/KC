// V2-ADMIN-MONEY-9, FR-FIN-005, FR-FIN-014 — Supabase adapter for the platform organization's books.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FinanceLedgerListFilters, FinanceLedgerUpsertInput, IFinanceLedgerRepository,
} from '@kc/application';
import {
  FinanceLedgerError,
  type FinanceEntry, type FinanceLedgerPage, type FinanceSummaryRow,
  parseFinanceEntryKind, parseFinanceEntryStatus,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapFinance } from './financeErrors';
import { platformOrgId } from './financeOrg';

type Client = SupabaseClient<Database>;
type EntryRow = Database['public']['Functions']['finance_ledger_list']['Returns'][number];

const DEFAULT_PAGE = 100;

/** One entry; transfers (no direction) and kinds or states this client does not know are dropped. */
export function mapFinanceEntryRow(row: EntryRow): FinanceEntry | null {
  const kind = parseFinanceEntryKind(row.kind);
  const status = parseFinanceEntryStatus(row.status);
  if (kind === null || status === null) return null;
  if (row.direction !== 'in' && row.direction !== 'out') return null;
  return {
    entryId: row.id,
    kind,
    direction: row.direction,
    amountCents: row.amount_agorot,
    currency: row.currency,
    occurredAt: new Date(row.occurred_at),
    counterparty: row.counterparty,
    category: row.category,
    description: row.description,
    status,
    accountId: row.account_id,
    isPublic: row.is_public,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * The books over the org-scoped finance RPCs (supabase/schemas/85_billing/100, 140), always for
 * the platform organization. Amounts are agorot, which the domain calls cents. The list is keyset:
 * a full page carries the cursor of its last row.
 */
export class SupabaseFinanceLedgerRepository implements IFinanceLedgerRepository {
  constructor(private readonly client: Client) {}

  async list(filters: FinanceLedgerListFilters): Promise<FinanceLedgerPage> {
    const orgId = await platformOrgId(this.client);
    const limit = filters.limit ?? DEFAULT_PAGE;
    const raw = unwrapFinance(
      'rpc:finance_ledger_list',
      await this.client.rpc('finance_ledger_list', {
        p_org_id: orgId,
        p_direction: filters.direction,
        p_status: filters.status,
        p_from: filters.fromDate?.toISOString(),
        p_to: filters.toDate?.toISOString(),
        p_limit: limit,
        p_after_occurred_at: filters.after?.occurredAt.toISOString(),
        p_after_id: filters.after?.entryId,
      }),
    ) ?? [];
    const last = raw.length === limit ? raw[raw.length - 1] : undefined;
    return {
      rows: raw.map(mapFinanceEntryRow).filter((e): e is FinanceEntry => e !== null),
      nextCursor: last ? { occurredAt: new Date(last.occurred_at), entryId: last.id } : null,
    };
  }

  async summary(fromDate?: Date, toDate?: Date): Promise<readonly FinanceSummaryRow[]> {
    const orgId = await platformOrgId(this.client);
    const rows = unwrapFinance(
      'rpc:finance_ledger_summary',
      await this.client.rpc('finance_ledger_summary', {
        p_org_id: orgId,
        p_from: fromDate?.toISOString(),
        p_to: toDate?.toISOString(),
      }),
    ) ?? [];
    return rows.map((r) => ({
      currency: r.currency,
      incomeCents: r.income_agorot,
      expenseCents: r.expense_agorot,
      netCents: r.net_agorot,
      entryCount: r.entry_count,
    }));
  }

  async upsert(input: FinanceLedgerUpsertInput): Promise<string> {
    const orgId = await platformOrgId(this.client);
    const id = unwrapFinance(
      'rpc:finance_ledger_upsert',
      await this.client.rpc('finance_ledger_upsert', {
        p_org_id: orgId,
        p_entry_id: input.entryId ?? undefined,
        p_kind: input.kind,
        p_amount_agorot: input.amountCents,
        p_occurred_at: input.occurredAt?.toISOString(),
        p_account_id: input.accountId,
        p_counterparty: input.counterparty ?? undefined,
        p_category: input.category ?? undefined,
        p_description: input.description ?? undefined,
        p_status: input.status,
        p_is_public: input.isPublic,
      }),
    );
    if (typeof id !== 'string') throw new FinanceLedgerError('unknown', 'finance_ledger_upsert did not return an id');
    return id;
  }

  /**
   * Voids the entry with the admin's reason: it stays in the books, leaves the default list and
   * counts nowhere (FR-FIN-005 AC2).
   */
  async delete(entryId: string, reason: string): Promise<void> {
    const orgId = await platformOrgId(this.client);
    unwrapFinance(
      'rpc:finance_ledger_mark',
      await this.client.rpc('finance_ledger_mark', { p_org_id: orgId, p_entry_id: entryId, p_void_reason: reason }),
    );
  }
}
