import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../database.types';
import { SupabaseFeatureFlagsRepository } from '../SupabaseFeatureFlagsRepository';
import { SupabaseProEntitlementRepository } from '../../payments/SupabaseProEntitlementRepository';

const clientWith = (members: Record<string, unknown>) => members as unknown as SupabaseClient<Database>;

describe('SupabaseFeatureFlagsRepository', () => {
  const flagsClient = (result: unknown) => {
    const select = vi.fn().mockResolvedValue(result);
    return { client: clientWith({ from: vi.fn(() => ({ select })) }), select };
  };

  it('maps the rows to a key → enabled record', async () => {
    const { client, select } = flagsClient({
      data: [
        { key: 'world_rides_enabled', enabled: true },
        { key: 'world_money_enabled', enabled: false },
      ],
      error: null,
    });

    expect(await new SupabaseFeatureFlagsRepository(client).listFlags()).toEqual({ world_rides_enabled: true, world_money_enabled: false });
    expect(select).toHaveBeenCalledWith('key, enabled');
  });

  it('is an empty record when no flag is set', async () => {
    expect(await new SupabaseFeatureFlagsRepository(flagsClient({ data: [], error: null }).client).listFlags()).toEqual({});
  });

  it('throws when the read fails, so a failure never looks like "no flags"', async () => {
    const { client } = flagsClient({ data: null, error: { message: 'permission denied for table app_flags' } });

    await expect(new SupabaseFeatureFlagsRepository(client).listFlags()).rejects.toThrow(/permission denied for table app_flags/);
  });
});

describe('SupabaseProEntitlementRepository', () => {
  const proClient = (result: unknown) => clientWith({ rpc: vi.fn().mockResolvedValue(result) });

  it.each([
    [{ is_pro: true }, true],
    [{ is_pro: false }, false],
    [{}, false],
    [null, false],
  ])('reads %j as Pro = %s', async (data, expected) => {
    expect(await new SupabaseProEntitlementRepository(proClient({ data, error: null })).isPro()).toBe(expected);
  });

  it('fails when the server refuses, instead of answering "not Pro"', async () => {
    const client = proClient({ data: null, error: { code: '42501', message: 'unauthenticated' } });

    await expect(new SupabaseProEntitlementRepository(client).isPro()).rejects.toMatchObject({ reason: 'unauthenticated' });
  });
});
