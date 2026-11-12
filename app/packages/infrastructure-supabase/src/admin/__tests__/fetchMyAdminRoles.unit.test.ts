// Regression: a transient get_my_admin_roles failure must be visible to the admin gate
// (throwOnError) instead of being cached as "no roles", which hid the admin portal.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMyAdminRoles } from '../fetchMyAdminRoles';

const clientWith = (result: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as SupabaseClient;

describe('fetchMyAdminRoles', () => {
  it('returns [] on RPC error by default (fail-closed)', async () => {
    expect(await fetchMyAdminRoles(clientWith({ data: null, error: { message: 'x' } }))).toEqual([]);
  });

  it('throws on RPC error when throwOnError is set', async () => {
    await expect(
      fetchMyAdminRoles(clientWith({ data: null, error: { message: 'x' } }), { throwOnError: true }),
    ).rejects.toBeDefined();
  });
});
