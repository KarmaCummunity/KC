// FR-FIN-023 — Supabase adapter for the admin-only donors overview.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IFinanceDonorsRepository } from '@kc/application';
import type { FinanceDonorSummary } from '@kc/domain';
import { toFinanceError } from './financeErrors';

interface DonorRow {
  donor_name: string | null;
  donations_count: number | string;
  total_cents: number | string;
  first_at: string;
  last_at: string;
}

const toInt = (v: number | string): number => (typeof v === 'number' ? v : Number.parseInt(v, 10));

export function mapFinanceDonorRow(row: DonorRow): FinanceDonorSummary {
  return {
    donorName: row.donor_name,
    donationsCount: toInt(row.donations_count),
    totalCents: toInt(row.total_cents),
    firstAt: new Date(row.first_at),
    lastAt: new Date(row.last_at),
  };
}

export class SupabaseFinanceDonorsRepository implements IFinanceDonorsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async summary(limit = 200): Promise<readonly FinanceDonorSummary[]> {
    const { data, error } = await this.client.rpc('finance_donors_summary', { p_limit: limit });
    if (error) throw toFinanceError(error);
    return (Array.isArray(data) ? (data as DonorRow[]) : []).map(mapFinanceDonorRow);
  }
}
