// FR-FIN-003 (lean) — Supabase adapter for financial accounts.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinanceAccountUpsertInput, IFinanceAccountsRepository } from '@kc/application';
import { FinanceLedgerError, parseFinanceAccountKind, type FinanceAccount } from '@kc/domain';
import { toFinanceError } from './financeErrors';

interface AccountRow {
  account_id: string;
  name: string;
  kind: string;
  last4: string | null;
  opening_balance_cents: number | string;
  opening_balance_at: string | null;
  is_active: boolean;
  sort_order: number;
  balance_cents: number | string;
  entry_count: number | string;
}

const toInt = (v: number | string): number => (typeof v === 'number' ? v : Number.parseInt(v, 10));

/** Pure row → domain mapping; rows with an unknown kind are dropped by the caller. */
export function mapFinanceAccountRow(row: AccountRow): FinanceAccount | null {
  const kind = parseFinanceAccountKind(row.kind);
  if (kind === null) return null;
  return {
    accountId: row.account_id,
    name: row.name,
    kind,
    last4: row.last4,
    openingBalanceCents: toInt(row.opening_balance_cents),
    // `date` columns arrive as YYYY-MM-DD; noon UTC keeps the calendar day stable in any timezone.
    openingBalanceAt: row.opening_balance_at ? new Date(`${row.opening_balance_at}T12:00:00.000Z`) : null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    balanceCents: toInt(row.balance_cents),
    entryCount: toInt(row.entry_count),
  };
}

export class SupabaseFinanceAccountsRepository implements IFinanceAccountsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<readonly FinanceAccount[]> {
    const { data, error } = await this.client.rpc('finance_accounts_list');
    if (error) throw toFinanceError(error);
    const raw = Array.isArray(data) ? (data as AccountRow[]) : [];
    return raw.map(mapFinanceAccountRow).filter((a): a is FinanceAccount => a !== null);
  }

  async upsert(input: FinanceAccountUpsertInput): Promise<string> {
    const { data, error } = await this.client.rpc('finance_account_upsert', {
      p_account_id: input.accountId ?? null,
      p_name: input.name ?? null,
      p_kind: input.kind ?? null,
      p_last4: input.last4 ?? null,
      p_opening_balance_cents: input.openingBalanceCents ?? null,
      p_opening_balance_at: input.openingBalanceAt ? input.openingBalanceAt.toISOString().slice(0, 10) : null,
      p_is_active: input.isActive ?? null,
      p_sort_order: input.sortOrder ?? null,
    });
    if (error) throw toFinanceError(error);
    if (typeof data !== 'string') {
      throw new FinanceLedgerError('unknown', 'finance_account_upsert did not return an id');
    }
    return data;
  }
}
