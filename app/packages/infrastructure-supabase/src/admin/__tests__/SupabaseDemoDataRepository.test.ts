import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseDemoDataRepository, mapDemoDataStatus, mapDemoDataWipeResult, mapDemoDataSeedResult,
} from '../SupabaseDemoDataRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

function repo(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => result);
  return { rpc, r: new SupabaseDemoDataRepository({ rpc } as unknown as SupabaseClient<any>) };
}

describe('demo data mappers', () => {
  it('maps status counts and defaults missing keys to 0', () => {
    expect(mapDemoDataStatus({ demo_users: 200, demo_organizations: 3, can_seed: true, has_saved_password: true }))
      .toEqual({ demoUsers: 200, demoOrganizations: 3, canSeed: true, hasSavedPassword: true });
    expect(mapDemoDataStatus(null))
      .toEqual({ demoUsers: 0, demoOrganizations: 0, canSeed: false, hasSavedPassword: false });
  });

  it('maps wipe counts including kept organizations', () => {
    expect(mapDemoDataWipeResult({ users_deleted: 200, organizations_deleted: 2, organizations_kept: 1 }))
      .toEqual({ usersDeleted: 200, organizationsDeleted: 2, organizationsKept: 1 });
    expect(mapDemoDataWipeResult(undefined)).toEqual({ usersDeleted: 0, organizationsDeleted: 0, organizationsKept: 0 });
  });
});

describe('mapDemoDataSeedResult', () => {
  it('maps the seeded counts and defaults missing keys to 0', () => {
    expect(mapDemoDataSeedResult({ users: 200, posts: 540, rides: 120, organizations: 3, follows: 9 }))
      .toEqual({ users: 200, posts: 540, rides: 120, organizations: 3 });
    expect(mapDemoDataSeedResult(null)).toEqual({ users: 0, posts: 0, rides: 0, organizations: 0 });
  });
});

describe('SupabaseDemoDataRepository', () => {
  it('getStatus calls admin_demo_data_status', async () => {
    const { rpc, r } = repo({ data: { demo_users: 5, demo_organizations: 1, can_seed: true, has_saved_password: false }, error: null });
    await expect(r.getStatus()).resolves.toEqual({ demoUsers: 5, demoOrganizations: 1, canSeed: true, hasSavedPassword: false });
    expect(rpc).toHaveBeenCalledWith('admin_demo_data_status');
  });

  it('wipe calls admin_wipe_demo_data', async () => {
    const { rpc, r } = repo({ data: { users_deleted: 5, organizations_deleted: 1, organizations_kept: 0 }, error: null });
    await expect(r.wipe()).resolves.toMatchObject({ usersDeleted: 5 });
    expect(rpc).toHaveBeenCalledWith('admin_wipe_demo_data');
  });

  it('seed passes the password through and omits it when not given', async () => {
    const { rpc, r } = repo({ data: { users: 200, posts: 1, rides: 1, organizations: 3 }, error: null });
    await expect(r.seed('SeedPass-2026')).resolves.toMatchObject({ users: 200 });
    expect(rpc).toHaveBeenLastCalledWith('admin_seed_demo_data', { p_password: 'SeedPass-2026' });
    await r.seed();
    expect(rpc).toHaveBeenLastCalledWith('admin_seed_demo_data', { p_password: undefined });
  });

  it('surfaces RPC errors', async () => {
    const { r } = repo({ data: null, error: { message: 'forbidden' } });
    await expect(r.seed()).rejects.toThrow('seedDemoData: forbidden');
    await expect(r.getStatus()).rejects.toThrow('getDemoDataStatus: forbidden');
    await expect(r.wipe()).rejects.toThrow('wipeDemoData: forbidden');
  });
});
