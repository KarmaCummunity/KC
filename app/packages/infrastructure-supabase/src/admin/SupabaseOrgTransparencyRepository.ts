// FR-FIN-022 — Supabase adapters for live public transparency (member read + admin settings).
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IOrgTransparencyRepository, ITransparencySettingsRepository, TransparencySettingsPatch,
} from '@kc/application';
import {
  DEFAULT_TRANSPARENCY_SETTINGS, HIDDEN_TRANSPARENCY, TRANSPARENCY_TOGGLES,
  type OrgTransparency, type TransparencySettings,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapFinance } from './financeErrors';
import { platformOrgId } from './financeOrg';

type Client = SupabaseClient<Database>;
type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** bigint values may arrive as numeric strings; anything non-numeric becomes null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pure mapping of the `rpc_org_transparency` jsonb (amounts in agorot, which the domain calls
 * cents); any malformed payload degrades to "hidden".
 */
export function mapOrgTransparency(raw: unknown): OrgTransparency {
  if (!isRecord(raw) || raw.enabled !== true) return HIDDEN_TRANSPARENCY;

  const income = num(raw.income_agorot);
  const expense = num(raw.expense_agorot);
  const net = num(raw.net_agorot);
  const lastEntry = typeof raw.last_entry_at === 'string' ? new Date(raw.last_entry_at) : null;

  return {
    enabled: true,
    currency: typeof raw.currency === 'string' ? raw.currency : 'ILS',
    lastEntryAt: lastEntry && !Number.isNaN(lastEntry.getTime()) ? lastEntry : null,
    totals: income !== null && expense !== null && net !== null
      ? { incomeCents: income, expenseCents: expense, netCents: net }
      : null,
    donationsCount: num(raw.donations_count),
    programRatio: num(raw.program_ratio),
    byCategory: Array.isArray(raw.by_category)
      ? raw.by_category.filter(isRecord).map((c) => ({ key: String(c.key), cents: num(c.agorot) ?? 0 }))
      : null,
    monthly: Array.isArray(raw.monthly)
      ? raw.monthly.filter(isRecord).map((m) => ({
          month: String(m.month),
          incomeCents: num(m.income_agorot) ?? 0,
          expenseCents: num(m.expense_agorot) ?? 0,
        }))
      : null,
  };
}

/** The switches of an `organizations` row; unknown or missing keys fall back to the safe default: off. */
export function mapTransparencySettings(raw: unknown): TransparencySettings {
  if (!isRecord(raw)) return DEFAULT_TRANSPARENCY_SETTINGS;
  const out: Record<string, boolean> = {};
  for (const t of TRANSPARENCY_TOGGLES) out[t] = raw[t] === true;
  return out as TransparencySettings;
}

export class SupabaseOrgTransparencyRepository implements IOrgTransparencyRepository {
  constructor(private readonly client: Client) {}

  async getPublic(slug?: string): Promise<OrgTransparency> {
    return mapOrgTransparency(unwrapFinance(
      'rpc:rpc_org_transparency',
      await this.client.rpc('rpc_org_transparency', { p_slug: slug }),
    ));
  }
}

/** The platform organization's switches: the `show_*` columns of its row (85_billing/100). */
export class SupabaseTransparencySettingsRepository implements ITransparencySettingsRepository {
  constructor(private readonly client: Client) {}

  async get(): Promise<TransparencySettings> {
    const orgId = await platformOrgId(this.client);
    return mapTransparencySettings(unwrapFinance(
      'table:organizations',
      await this.client
        .from('organizations')
        .select(TRANSPARENCY_TOGGLES.join(', '))
        .eq('id', orgId)
        .maybeSingle(),
    ));
  }

  async set(patch: TransparencySettingsPatch): Promise<TransparencySettings> {
    const orgId = await platformOrgId(this.client);
    unwrapFinance(
      'rpc:finance_transparency_settings_set',
      await this.client.rpc('finance_transparency_settings_set', { p_org_id: orgId, p_settings: patch }),
    );
    return this.get();
  }
}
