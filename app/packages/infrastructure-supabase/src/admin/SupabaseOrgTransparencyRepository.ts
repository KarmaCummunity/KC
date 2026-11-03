// FR-FIN-022 — Supabase adapters for live public transparency (public read + admin settings).
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IOrgTransparencyRepository, ITransparencySettingsRepository, TransparencySettingsPatch,
} from '@kc/application';
import {
  DEFAULT_TRANSPARENCY_SETTINGS, HIDDEN_TRANSPARENCY, TRANSPARENCY_TOGGLES,
  type OrgTransparency, type TransparencySettings,
} from '@kc/domain';
import { toFinanceError } from './financeErrors';

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** bigint columns may arrive as numeric strings; anything non-numeric becomes null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pure mapping of the `rpc_org_transparency` jsonb; any malformed payload degrades to "hidden". */
export function mapOrgTransparency(raw: unknown): OrgTransparency {
  if (!isRecord(raw) || raw.enabled !== true) return HIDDEN_TRANSPARENCY;

  const income = num(raw.income_cents);
  const expense = num(raw.expense_cents);
  const net = num(raw.net_cents);
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
      ? raw.by_category.filter(isRecord).map((c) => ({ key: String(c.key), cents: num(c.cents) ?? 0 }))
      : null,
    monthly: Array.isArray(raw.monthly)
      ? raw.monthly.filter(isRecord).map((m) => ({
          month: String(m.month),
          incomeCents: num(m.income_cents) ?? 0,
          expenseCents: num(m.expense_cents) ?? 0,
        }))
      : null,
  };
}

/** Unknown / missing keys fall back to the safe default: off. */
export function mapTransparencySettings(raw: unknown): TransparencySettings {
  if (!isRecord(raw)) return DEFAULT_TRANSPARENCY_SETTINGS;
  const out: Record<string, boolean> = {};
  for (const t of TRANSPARENCY_TOGGLES) out[t] = raw[t] === true;
  return out as TransparencySettings;
}

export class SupabaseOrgTransparencyRepository implements IOrgTransparencyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getPublic(slug?: string): Promise<OrgTransparency> {
    const { data, error } = await this.client.rpc('rpc_org_transparency', { p_slug: slug ?? null });
    if (error) throw toFinanceError(error);
    return mapOrgTransparency(data);
  }
}

export class SupabaseTransparencySettingsRepository implements ITransparencySettingsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async get(): Promise<TransparencySettings> {
    const { data, error } = await this.client.rpc('finance_transparency_settings_get');
    if (error) throw toFinanceError(error);
    return mapTransparencySettings(data);
  }

  async set(patch: TransparencySettingsPatch): Promise<TransparencySettings> {
    const { data, error } = await this.client.rpc('finance_transparency_settings_set', { p_settings: patch });
    if (error) throw toFinanceError(error);
    return mapTransparencySettings(data);
  }
}
