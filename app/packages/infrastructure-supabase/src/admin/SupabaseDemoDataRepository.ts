// FR-ADMIN-031 — super-admin RPCs that inspect and wipe the kc-dev demo data (migration 0591).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

export interface DemoDataStatus {
  readonly demoUsers: number;
  readonly demoOrganizations: number;
  /** True only on the kc-dev database, where the demo data may be (re)created. */
  readonly canSeed: boolean;
  /** True once a seed password was given, so a restore needs no password. */
  readonly hasSavedPassword: boolean;
}

export interface DemoDataWipeResult {
  readonly usersDeleted: number;
  readonly organizationsDeleted: number;
  /** Demo nonprofits left in place because they have payment history. */
  readonly organizationsKept: number;
}

export interface DemoDataSeedResult {
  readonly users: number;
  readonly posts: number;
  readonly rides: number;
  readonly organizations: number;
}

// RPCs return untyped jsonb; read each key defensively so a missing field becomes 0, not NaN.
const count = (obj: Record<string, unknown>, key: string): number => Number(obj[key] ?? 0);
const asObject = (data: unknown): Record<string, unknown> =>
  data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};

export function mapDemoDataStatus(data: unknown): DemoDataStatus {
  const o = asObject(data);
  return {
    demoUsers: count(o, 'demo_users'),
    demoOrganizations: count(o, 'demo_organizations'),
    canSeed: o.can_seed === true,
    hasSavedPassword: o.has_saved_password === true,
  };
}

export function mapDemoDataWipeResult(data: unknown): DemoDataWipeResult {
  const o = asObject(data);
  return {
    usersDeleted: count(o, 'users_deleted'),
    organizationsDeleted: count(o, 'organizations_deleted'),
    organizationsKept: count(o, 'organizations_kept'),
  };
}

export function mapDemoDataSeedResult(data: unknown): DemoDataSeedResult {
  const o = asObject(data);
  return {
    users: count(o, 'users'),
    posts: count(o, 'posts'),
    rides: count(o, 'rides'),
    organizations: count(o, 'organizations'),
  };
}

export class SupabaseDemoDataRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Super admin only: how much demo data currently exists. */
  async getStatus(): Promise<DemoDataStatus> {
    const { data, error } = await this.client.rpc('admin_demo_data_status');
    if (error) throw new Error(`getDemoDataStatus: ${error.message}`);
    return mapDemoDataStatus(data);
  }

  /** Super admin only: deletes the demo users (with their content) and demo nonprofits. */
  async wipe(): Promise<DemoDataWipeResult> {
    const { data, error } = await this.client.rpc('admin_wipe_demo_data');
    if (error) throw new Error(`wipeDemoData: ${error.message}`);
    return mapDemoDataWipeResult(data);
  }

  /**
   * Super admin, kc-dev only: wipes then recreates the demo data. `password` (min 8 chars) is the
   * seed users' login password; it is needed once and saved server-side as a hash.
   */
  async seed(password?: string): Promise<DemoDataSeedResult> {
    const { data, error } = await this.client.rpc('admin_seed_demo_data', { p_password: password });
    if (error) throw new Error(`seedDemoData: ${error.message}`);
    return mapDemoDataSeedResult(data);
  }
}
