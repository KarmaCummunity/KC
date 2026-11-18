// app/packages/infrastructure-supabase/src/imports/SupabaseImportTelemetryRepository.ts
// FR-IMPORT-010 AC4 — reads the import funnel and the per-field edit rate (`admin_import_funnel`,
// `admin_import_field_edit_rates`; moderators and above, enforced by the functions).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IImportTelemetryRepository, ImportFieldEditRate, ImportFunnel } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** The funnel of a window with no attempts. */
const EMPTY_FUNNEL: ImportFunnel = { attempts: 0, manual: 0, drafted: 0, published: 0, discarded: 0, providerCalls: 0 };

export class SupabaseImportTelemetryRepository implements IImportTelemetryRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getFunnel(days: number): Promise<ImportFunnel> {
    const rows = unwrapCall('rpc:admin_import_funnel', await this.client.rpc('admin_import_funnel', { p_days: days })) ?? [];
    const row = rows[0];
    if (!row) return EMPTY_FUNNEL;
    return {
      attempts: Number(row.attempts),
      manual: Number(row.manual),
      drafted: Number(row.drafted),
      published: Number(row.published),
      discarded: Number(row.discarded),
      providerCalls: Number(row.provider_calls),
    };
  }

  async getFieldEditRates(days: number): Promise<ImportFieldEditRate[]> {
    const rows =
      unwrapCall('rpc:admin_import_field_edit_rates', await this.client.rpc('admin_import_field_edit_rates', { p_days: days })) ?? [];
    return rows.map((r) => ({
      field: r.field,
      reported: Number(r.reported),
      edited: Number(r.edited),
      // numeric arrives as a number or a string, and is null when nothing was reported.
      editRate: r.edit_rate === null || r.edit_rate === undefined ? null : Number(r.edit_rate),
    }));
  }
}
