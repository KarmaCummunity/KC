import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseAppFlagsAdminRepository } from '../SupabaseAppFlagsAdminRepository';

describe('SupabaseAppFlagsAdminRepository (#2277)', () => {
  it('switches a flag through admin_set_app_flag with its key and value', async () => {
    const { client, calls } = createFakeClient({ rpc: { admin_set_app_flag: ok({ key: 'world_food_enabled', enabled: false }) } });
    await new SupabaseAppFlagsAdminRepository(client).setFlag('world_food_enabled', false);
    expect(callsTo(calls, 'admin_set_app_flag')[0]?.args).toEqual({ p_key: 'world_food_enabled', p_enabled: false });
  });

  it('rejects when the server refuses the caller, and degrades when the function is missing', async () => {
    const forbidden = createFakeClient({ rpc: { admin_set_app_flag: fail('42501', 'forbidden') } });
    await expect(new SupabaseAppFlagsAdminRepository(forbidden.client).setFlag('world_food_enabled', true)).rejects.toThrow();
    const missing = createFakeClient({ rpc: { admin_set_app_flag: fail('PGRST202', 'nope') } });
    await expect(new SupabaseAppFlagsAdminRepository(missing.client).setFlag('world_food_enabled', true))
      .rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
