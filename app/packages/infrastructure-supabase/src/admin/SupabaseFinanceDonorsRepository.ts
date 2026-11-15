// FR-FIN-023 — Supabase adapter for the donors overview of the platform organization.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IFinanceDonorsRepository } from '@kc/application';
import type { FinanceDonorSummary } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapFinance } from './financeErrors';
import { platformOrgId } from './financeOrg';

type Client = SupabaseClient<Database>;
type DonorRow = Database['public']['Functions']['finance_donors_summary']['Returns'][number];

export function mapFinanceDonorRow(row: DonorRow): FinanceDonorSummary {
  return {
    donorName: row.donor_name,
    donationsCount: row.donations_count,
    totalCents: row.total_agorot,
    firstAt: new Date(row.first_at),
    lastAt: new Date(row.last_at),
  };
}

/** Donors grouped by member or party name, largest total first (`finance_donors_summary`, 85_billing/140). */
export class SupabaseFinanceDonorsRepository implements IFinanceDonorsRepository {
  constructor(private readonly client: Client) {}

  async summary(limit = 200): Promise<readonly FinanceDonorSummary[]> {
    const orgId = await platformOrgId(this.client);
    const rows = unwrapFinance(
      'rpc:finance_donors_summary',
      await this.client.rpc('finance_donors_summary', { p_org_id: orgId, p_limit: limit }),
    );
    return (rows ?? []).map(mapFinanceDonorRow);
  }
}
