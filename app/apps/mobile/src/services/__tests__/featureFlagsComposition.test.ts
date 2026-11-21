import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
// The real adapter over a stubbed client.
vi.mock('@kc/infrastructure-supabase', async () => {
  const actual = await vi.importActual<typeof import('@kc/infrastructure-supabase')>('@kc/infrastructure-supabase');
  return { ...actual, getSupabaseClient: () => ({ from: () => ({ select }) }) };
});
vi.mock('../authSecureStorage', () => ({ pickAuthStorage: () => undefined }));

import { fetchRemoteFeatureFlags } from '../featureFlagsComposition';

beforeEach(() => vi.clearAllMocks());

describe('fetchRemoteFeatureFlags', () => {
  it('maps the rows to a key → enabled record', async () => {
    select.mockResolvedValue({
      data: [
        { key: 'world_rides_enabled', enabled: true },
        { key: 'world_money_enabled', enabled: false },
      ],
      error: null,
    });
    await expect(fetchRemoteFeatureFlags()).resolves.toEqual({ world_rides_enabled: true, world_money_enabled: false });
  });

  it('is an empty record when no flag is set', async () => {
    select.mockResolvedValue({ data: [], error: null });
    await expect(fetchRemoteFeatureFlags()).resolves.toEqual({});
  });

  // A failure must not look like "no flags": the query cache would keep `{}` as fresh data.
  it('throws when the read fails, for example RLS denying the caller', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'permission denied for table app_flags' } });
    await expect(fetchRemoteFeatureFlags()).rejects.toThrow(/permission denied for table app_flags/);
  });
});
