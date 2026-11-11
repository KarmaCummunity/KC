import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseRideHouseNumberRepository } from '../SupabaseRideHouseNumberRepository';

describe('SupabaseRideHouseNumberRepository', () => {
  it('saves both ends into the private location, clearing an end left out', async () => {
    const { client, calls } = createFakeClient({ tables: { post_private_locations: ok(null) } });
    await new SupabaseRideHouseNumberRepository(client).save('p1', { origin: ' 12 ' });
    const upsert = callsTo(calls, 'post_private_locations')[0];
    expect(upsert?.kind).toBe('upsert');
    expect(upsert?.payload).toEqual({ post_id: 'p1', street_number: '12', destination_street_number: null });
  });

  it('reads the numbers the server releases', async () => {
    const { client } = createFakeClient({
      rpc: { get_post_private_location: ok({ street_number: '12', destination_street_number: null }) },
    });
    expect(await new SupabaseRideHouseNumberRepository(client).get('p1')).toEqual({ origin: '12' });
  });

  it('returns nothing when the server releases no row', async () => {
    const { client } = createFakeClient({ rpc: { get_post_private_location: ok(null) } });
    expect(await new SupabaseRideHouseNumberRepository(client).get('p1')).toEqual({});
  });

  it('keeps a refusal reason and a missing table distinct', async () => {
    const refused = createFakeClient({ rpc: { get_post_private_location: fail('P0001', 'not_participant') } });
    await expect(new SupabaseRideHouseNumberRepository(refused.client).get('p1')).rejects.toBeInstanceOf(BackendRuleError);
    const missing = createFakeClient({ tables: { post_private_locations: fail('PGRST205', 'no table') } });
    await expect(new SupabaseRideHouseNumberRepository(missing.client).save('p1', {})).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
