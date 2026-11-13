// FR-FIN-003 (lean) — Supabase adapter for the financial accounts of the platform organization.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinanceAccountUpsertInput, IFinanceAccountsRepository } from '@kc/application';
import { FinanceLedgerError, parseFinanceAccountKind, type FinanceAccount } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapFinance } from './financeErrors';
import { platformOrgId } from './financeOrg';

type Client = SupabaseClient<Database>;
type AccountRow = Database['public']['Functions']['finance_accounts_list']['Returns'][number];

/** Pure row → domain mapping; rows with an unknown kind are dropped by the caller. */
export function mapFinanceAccountRow(row: AccountRow): FinanceAccount | null {
  const kind = parseFinanceAccountKind(row.kind);
  if (kind === null) return null;
  return {
    accountId: row.id,
    name: row.name,
    kind,
    last4: row.last4,
    openingBalanceCents: row.opening_balance_agorot,
    // `date` columns arrive as YYYY-MM-DD; noon UTC keeps the calendar day stable in any timezone.
    openingBalanceAt: row.opening_balance_at ? new Date(`${row.opening_balance_at}T12:00:00.000Z`) : null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    balanceCents: row.balance_agorot,
    // The baseline account list does not count entries.
    entryCount: null,
  };
}

/**
 * Accounts over `finance_accounts_list` / `finance_account_upsert` (supabase/schemas/85_billing/100).
 * Amounts are agorot, which the domain calls cents (minor units). The display order is the
 * server's (active first, then sort order, then name); a new order cannot be set from the app.
 */
export class SupabaseFinanceAccountsRepository implements IFinanceAccountsRepository {
  constructor(private readonly client: Client) {}

  async list(): Promise<readonly FinanceAccount[]> {
    const orgId = await platformOrgId(this.client);
    const rows = unwrapFinance(
      'rpc:finance_accounts_list',
      await this.client.rpc('finance_accounts_list', { p_org_id: orgId }),
    );
    return (rows ?? []).map(mapFinanceAccountRow).filter((a): a is FinanceAccount => a !== null);
  }

  async upsert(input: FinanceAccountUpsertInput): Promise<string> {
    const orgId = await platformOrgId(this.client);
    const id = unwrapFinance(
      'rpc:finance_account_upsert',
      await this.client.rpc('finance_account_upsert', {
        p_org_id: orgId,
        p_account_id: input.accountId ?? undefined,
        p_name: input.name,
        p_kind: input.kind,
        // The baseline keeps a stored last-4 when none is sent; it cannot be cleared from here.
        p_last4: input.last4 || undefined,
        p_opening_balance_agorot: input.openingBalanceCents,
        p_opening_balance_at: input.openingBalanceAt ? input.openingBalanceAt.toISOString().slice(0, 10) : undefined,
        p_is_active: input.isActive,
      }),
    );
    if (typeof id !== 'string') throw new FinanceLedgerError('unknown', 'finance_account_upsert did not return an id');
    return id;
  }
}
