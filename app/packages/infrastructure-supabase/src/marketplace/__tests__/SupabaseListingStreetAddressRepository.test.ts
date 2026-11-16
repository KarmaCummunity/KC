import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseListingStreetAddressRepository } from '../SupabaseListingStreetAddressRepository';

describe('SupabaseListingStreetAddressRepository', () => {
  it('saves the street and the house number into the private location of the post', async () => {
    const { client, calls } = createFakeClient({ tables: { post_private_locations: ok(null) } });
    await new SupabaseListingStreetAddressRepository(client).save('p1', { street: 'הרצל', streetNumber: '12' });
    const upsert = callsTo(calls, 'post_private_locations')[0];
    expect(upsert?.kind).toBe('upsert');
    expect(upsert?.payload).toEqual({ post_id: 'p1', street: 'הרצל', street_number: '12' });
  });

  it('reads the address the owner stored', async () => {
    const { client } = createFakeClient({
      tables: { post_private_locations: ok({ street: 'הרצל', street_number: '12' }) },
    });
    expect(await new SupabaseListingStreetAddressRepository(client).getOwn('p1')).toEqual({
      street: 'הרצל',
      streetNumber: '12',
    });
  });

  it('returns null when no row is readable or the row has no street', async () => {
    const none = createFakeClient({ tables: { post_private_locations: ok(null) } });
    expect(await new SupabaseListingStreetAddressRepository(none.client).getOwn('p1')).toBeNull();
    // A ride stores house numbers without a street in the same table.
    const numberOnly = createFakeClient({ tables: { post_private_locations: ok({ street: null, street_number: '3' }) } });
    expect(await new SupabaseListingStreetAddressRepository(numberOnly.client).getOwn('p1')).toBeNull();
  });

  it('reports a missing table as an unavailable backend', async () => {
    const missing = createFakeClient({ tables: { post_private_locations: fail('PGRST205', 'no table') } });
    await expect(
      new SupabaseListingStreetAddressRepository(missing.client).save('p1', { street: 'הרצל', streetNumber: '12' }),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
