import { describe, it, expect } from 'vitest';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import {
  supabaseGetEditableProfile,
  supabaseSetContactPhone,
  supabaseSetProfileAddressLines,
  supabaseUpdateEditableProfile,
} from '../editableProfileSupabase';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });

const USER_ROW = { display_name: 'Dana', city_id: '5000', biography: 'bio', avatar_url: 'https://cdn/a.jpg' };
const PRIVATE_ROW = { contact_phone: '050-1234567', profile_street: 'Herzl', profile_street_number: '12' };

describe('supabaseGetEditableProfile', () => {
  it('reads the public columns, the city name and — for the owner — the private fields', async () => {
    const { client, calls } = createFakeClient({
      tables: { users: ok(USER_ROW), cities: ok({ name_he: 'Tel Aviv' }), user_private: ok(PRIVATE_ROW) },
      userId: 'u1',
    });

    const profile = await supabaseGetEditableProfile(client, 'u1');

    expect(profile).toEqual({
      displayName: 'Dana',
      city: '5000',
      cityName: 'Tel Aviv',
      profileStreet: 'Herzl',
      profileStreetNumber: '12',
      contactPhone: '050-1234567',
      biography: 'bio',
      avatarUrl: 'https://cdn/a.jpg',
    });
    expect(callsTo(calls, 'users')[0]?.columns).toBe('display_name, city_id, biography, avatar_url');
    expect(callsTo(calls, 'users')[0]?.filters).toContainEqual(['eq', 'id', 'u1']);
    expect(callsTo(calls, 'user_private')[0]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it("returns null private fields for another member's profile, without reading user_private", async () => {
    const { client, calls } = createFakeClient({
      tables: { users: ok(USER_ROW), cities: ok({ name_he: 'Tel Aviv' }), user_private: ok(PRIVATE_ROW) },
      userId: 'someone-else',
    });

    const profile = await supabaseGetEditableProfile(client, 'u1');

    expect(profile).toMatchObject({ profileStreet: null, profileStreetNumber: null, contactPhone: null });
    expect(callsTo(calls, 'user_private')).toHaveLength(0);
  });

  it('preserves null for the nullable columns and skips the city lookup without a city', async () => {
    const { client, calls } = createFakeClient({
      tables: {
        users: ok({ display_name: null, city_id: null, biography: null, avatar_url: null }),
        user_private: ok(null),
      },
      userId: 'u1',
    });

    const profile = await supabaseGetEditableProfile(client, 'u1');

    expect(profile).toEqual({
      displayName: null,
      city: null,
      cityName: null,
      profileStreet: null,
      profileStreetNumber: null,
      contactPhone: null,
      biography: null,
      avatarUrl: null,
    });
    expect(callsTo(calls, 'cities')).toHaveLength(0);
  });

  it('throws "no row" when the profile is missing or hidden', async () => {
    const { client } = createFakeClient({ tables: { users: ok(null) } });

    await expect(supabaseGetEditableProfile(client, 'u1')).rejects.toThrow('no row');
  });

  it('surfaces a query failure', async () => {
    const { client } = createFakeClient({ tables: { users: { data: null, error: { message: 'timeout' } } } });

    await expect(supabaseGetEditableProfile(client, 'u1')).rejects.toThrow('timeout');
  });
});

describe('supabaseSetProfileAddressLines / supabaseSetContactPhone', () => {
  it('updates both address columns of user_private together', async () => {
    const { client, calls } = createFakeClient();

    await supabaseSetProfileAddressLines(client, 'u1', 'Herzl', '12');

    expect(calls[0]).toMatchObject({
      kind: 'update',
      table: 'user_private',
      payload: { profile_street: 'Herzl', profile_street_number: '12' },
    });
    expect(calls[0]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it('forwards null/null verbatim (clear-the-address case)', async () => {
    const { client, calls } = createFakeClient();

    await supabaseSetProfileAddressLines(client, 'u1', null, null);

    expect(calls[0]?.payload).toEqual({ profile_street: null, profile_street_number: null });
  });

  it('writes the contact phone to user_private', async () => {
    const { client, calls } = createFakeClient();

    await supabaseSetContactPhone(client, 'u1', '050-1234567');

    expect(calls[0]).toMatchObject({ table: 'user_private', payload: { contact_phone: '050-1234567' } });
  });

  it('surfaces a constraint failure (the address pair)', async () => {
    const { client } = createFakeClient({
      tables: { user_private: { data: null, error: { code: '23514', message: 'violates check user_private_address_pair_chk' } } },
    });

    await expect(supabaseSetProfileAddressLines(client, 'u1', 'Herzl', null)).rejects.toThrow('address_pair');
  });
});

describe('supabaseUpdateEditableProfile', () => {
  it('splits a multi-field patch into one statement per table, public columns first', async () => {
    const { client, calls } = createFakeClient();

    await supabaseUpdateEditableProfile(client, 'u1', {
      displayName: 'Dana',
      city: '5000',
      biography: 'bio',
      avatarUrl: 'https://cdn/a.jpg',
      profileStreet: 'Herzl',
      profileStreetNumber: '12',
      contactPhone: '050-1234567',
    });

    expect(calls.map((c) => [c.table, c.payload])).toEqual([
      ['users', { display_name: 'Dana', city_id: '5000', biography: 'bio', avatar_url: 'https://cdn/a.jpg' }],
      ['user_private', { profile_street: 'Herzl', profile_street_number: '12', contact_phone: '050-1234567' }],
    ]);
  });

  it('writes only the table a single field belongs to', async () => {
    const { client, calls } = createFakeClient();

    await supabaseUpdateEditableProfile(client, 'u1', { contactPhone: '050' });

    expect(calls.map((c) => c.table)).toEqual(['user_private']);
  });

  it('preserves explicit null in nullable fields (clear-the-value semantic)', async () => {
    const { client, calls } = createFakeClient();

    await supabaseUpdateEditableProfile(client, 'u1', { biography: null, avatarUrl: null, contactPhone: null });

    expect(calls[0]?.payload).toEqual({ biography: null, avatar_url: null });
    expect(calls[1]?.payload).toEqual({ contact_phone: null });
  });

  it('does not call the database for an empty patch or one of undefined fields', async () => {
    const { client, calls } = createFakeClient();

    await supabaseUpdateEditableProfile(client, 'u1', {});
    await supabaseUpdateEditableProfile(client, 'u1', { displayName: undefined, contactPhone: undefined });

    expect(calls).toHaveLength(0);
  });

  it('writes nothing private when the public update is refused (an unknown city)', async () => {
    const { client, calls } = createFakeClient({
      tables: { users: { data: null, error: { code: '23503', message: 'violates foreign key users_city_id_fkey' } } },
    });

    await expect(
      supabaseUpdateEditableProfile(client, 'u1', { city: 'no-such-city', contactPhone: '050' }),
    ).rejects.toThrow('foreign key');
    expect(callsTo(calls, 'user_private')).toHaveLength(0);
  });
});
