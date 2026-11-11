// FR-ADMIN-031 — super-admin RPCs that inspect and wipe the kc-dev demo data (migration 0591).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.legacy.types';

export interface DemoDataStatus {
  readonly demoUsers: number;
  readonly demoOrganizations: number;
  /** Ride offers/requests on `posts` (rides world) — feed-visible after migration 0676. */
  readonly demoRidePosts: number;
  /** Item give/request posts (non-rides). */
  readonly demoItemPosts: number;
  /** Leftover `ride_listings` rows; should be 0 after a full restore on current seed. */
  readonly demoLegacyRideListings: number;
  /** Staff rows on `[DEMO]` nonprofits (`demo_seed`). */
  readonly demoOrgMemberships: number;
  /** `media_assets` paths under `demo/kc-dev/` (storage upload separate). */
  readonly demoPostMedia: number;
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

export interface DemoDataOperationStep<R = DemoDataWipeResult | DemoDataSeedResult> {
  readonly done: boolean;
  readonly progressKey?: string;
  /** True when this step deleted nothing because rows were locked; the caller should wait and retry. */
  readonly retry?: boolean;
  readonly result?: R;
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
    demoRidePosts: count(o, 'demo_ride_posts'),
    demoItemPosts: count(o, 'demo_item_posts'),
    demoLegacyRideListings: count(o, 'demo_legacy_ride_listings'),
    demoOrgMemberships: count(o, 'demo_org_memberships'),
    demoPostMedia: count(o, 'demo_post_media'),
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

export function mapDemoDataWipeStep(data: unknown): DemoDataOperationStep<DemoDataWipeResult> {
  const o = asObject(data);
  const done = o.done === true;
  const result = o.result !== undefined ? mapDemoDataWipeResult(o.result) : undefined;
  const progressKey = typeof o.progress_key === 'string' ? o.progress_key : undefined;
  return { done, progressKey, retry: o.retry === true, result };
}

export function mapDemoDataSeedStep(data: unknown): DemoDataOperationStep<DemoDataSeedResult> {
  const o = asObject(data);
  const done = o.done === true;
  const result = o.result !== undefined ? mapDemoDataSeedResult(o.result) : undefined;
  const progressKey = typeof o.progress_key === 'string' ? o.progress_key : undefined;
  return { done, progressKey, retry: o.retry === true, result };
}

const WIPE_STEP_GUARD = 80;
const SEED_STEP_GUARD = 120;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  async wipe(onProgress?: (progressKey: string) => void): Promise<DemoDataWipeResult> {
    let step: DemoDataOperationStep<DemoDataWipeResult> = { done: false };
    let guard = 0;
    while (!step.done && guard < WIPE_STEP_GUARD) {
      guard += 1;
      step = await this.wipeStep();
      if (step.progressKey) onProgress?.(step.progressKey);
      if (!step.done && step.retry) await pause(300);
    }
    if (!step.done || !step.result) {
      throw new Error('wipeDemoData: incomplete stepped wipe');
    }
    return step.result;
  }

  async wipeStep(): Promise<DemoDataOperationStep<DemoDataWipeResult>> {
    const { data, error } = await this.client.rpc('admin_wipe_demo_data_step');
    if (error) throw new Error(`wipeDemoData: ${error.message}`);
    return mapDemoDataWipeStep(data);
  }

  /**
   * Super admin, kc-dev only: wipes then recreates the demo data. `password` (min 8 chars) is the
   * seed users' login password; it is needed once and saved server-side as a hash.
   */
  async seed(password?: string, onProgress?: (progressKey: string) => void): Promise<DemoDataSeedResult> {
    let step: DemoDataOperationStep<DemoDataSeedResult> = { done: false };
    let sentPassword = false;
    let guard = 0;
    while (!step.done && guard < SEED_STEP_GUARD) {
      guard += 1;
      step = await this.seedStep(!sentPassword ? password : undefined);
      sentPassword = true;
      if (step.progressKey) onProgress?.(step.progressKey);
      if (!step.done && step.retry) await pause(300);
    }
    if (!step.done || !step.result) {
      throw new Error('seedDemoData: incomplete stepped seed');
    }
    return step.result;
  }

  async seedStep(password?: string): Promise<DemoDataOperationStep<DemoDataSeedResult>> {
    const { data, error } = await this.client.rpc('admin_seed_demo_data_step', {
      p_password: password,
    });
    if (error) throw new Error(`seedDemoData: ${error.message}`);
    return mapDemoDataSeedStep(data);
  }
}
