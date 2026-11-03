// V2-ADMIN-MONEY-9 — Supabase adapter for the admin finance ledger.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FinanceLedgerListFilters, FinanceLedgerUpsertInput, IFinanceLedgerRepository,
} from '@kc/application';
import {
  FinanceLedgerError,
  type FinanceEntry, type FinanceLedgerPage, type FinanceSummaryRow,
  parseFinanceEntryKind, parseFinanceEntryStatus,
} from '@kc/domain';
import { toFinanceError } from './financeErrors';

interface EntryRow {
  entry_id: string;
  kind: string;
  direction: string;
  amount_cents: number | string;
  currency: string;
  occurred_at: string;
  counterparty: string | null;
  category: string | null;
  description: string | null;
  reference_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  // 0470 columns: optional so an older server (migration not yet applied) still maps.
  account_id?: string | null;
  is_public?: boolean | null;
  total_count: number | string;
}

interface SummaryRow {
  currency: string;
  income_cents: number | string;
  expense_cents: number | string;
  net_cents: number | string;
  entry_count: number | string;
}

function toInt(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

function mapRow(row: EntryRow): FinanceEntry | null {
  const kind   = parseFinanceEntryKind(row.kind);
  const status = parseFinanceEntryStatus(row.status);
  if (kind === null || status === null) return null;
  if (row.direction !== 'in' && row.direction !== 'out') return null;
  return {
    entryId:      row.entry_id,
    kind,
    direction:    row.direction,
    amountCents:  toInt(row.amount_cents),
    currency:     row.currency,
    occurredAt:   new Date(row.occurred_at),
    counterparty: row.counterparty,
    category:     row.category,
    description:  row.description,
    referenceUrl: row.reference_url,
    status,
    accountId:    row.account_id ?? null,
    isPublic:     row.is_public ?? true,
    createdAt:    new Date(row.created_at),
    updatedAt:    new Date(row.updated_at),
  };
}

function totalOf(rows: readonly EntryRow[]): number {
  if (rows.length === 0) return 0;
  const first = rows[0]!.total_count;
  return typeof first === 'number' ? first : Number.parseInt(first, 10);
}

export class SupabaseFinanceLedgerRepository implements IFinanceLedgerRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(filters: FinanceLedgerListFilters): Promise<FinanceLedgerPage> {
    const { data, error } = await this.client.rpc('finance_ledger_list', {
      p_direction: filters.direction ?? null,
      p_kind:      filters.kind      ?? null,
      p_status:    filters.status    ?? null,
      p_from:      filters.fromDate ? filters.fromDate.toISOString() : null,
      p_to:        filters.toDate   ? filters.toDate.toISOString()   : null,
      p_limit:     filters.limit  ?? 100,
      p_offset:    filters.offset ?? 0,
    });
    if (error) throw toFinanceError(error);
    const raw = Array.isArray(data) ? (data as EntryRow[]) : [];
    const rows: FinanceEntry[] = [];
    for (const r of raw) {
      const m = mapRow(r);
      if (m !== null) rows.push(m);
    }
    return { rows, totalCount: totalOf(raw) };
  }

  async summary(fromDate?: Date, toDate?: Date): Promise<readonly FinanceSummaryRow[]> {
    const { data, error } = await this.client.rpc('finance_ledger_summary', {
      p_from: fromDate ? fromDate.toISOString() : null,
      p_to:   toDate   ? toDate.toISOString()   : null,
    });
    if (error) throw toFinanceError(error);
    const raw = Array.isArray(data) ? (data as SummaryRow[]) : [];
    return raw.map((r) => ({
      currency:     r.currency,
      incomeCents:  toInt(r.income_cents),
      expenseCents: toInt(r.expense_cents),
      netCents:     toInt(r.net_cents),
      entryCount:   toInt(r.entry_count),
    }));
  }

  async upsert(input: FinanceLedgerUpsertInput): Promise<string> {
    const { data, error } = await this.client.rpc('finance_ledger_upsert', {
      p_entry_id:     input.entryId      ?? null,
      p_kind:         input.kind         ?? null,
      p_amount_cents: input.amountCents  ?? null,
      p_currency:     input.currency     ?? null,
      p_occurred_at:  input.occurredAt ? input.occurredAt.toISOString() : null,
      p_counterparty: input.counterparty ?? null,
      p_category:     input.category     ?? null,
      p_description:  input.description  ?? null,
      p_reference_url: input.referenceUrl ?? null,
      p_status:       input.status       ?? null,
      p_account_id:   input.accountId    ?? null,
      p_is_public:    input.isPublic     ?? null,
    });
    if (error) throw toFinanceError(error);
    if (typeof data !== 'string') {
      throw new FinanceLedgerError('unknown', 'finance_ledger_upsert did not return an id');
    }
    return data;
  }

  async delete(entryId: string): Promise<void> {
    const { error } = await this.client.rpc('finance_ledger_delete', { p_entry_id: entryId });
    if (error) throw toFinanceError(error);
  }
}
