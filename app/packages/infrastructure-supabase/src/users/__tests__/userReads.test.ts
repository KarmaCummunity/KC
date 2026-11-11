import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import { USER_COLUMNS, USER_STATS_COLUMNS } from '../mapUserRow';
import { fetchUserBy, hydrateUsers, sessionUserId } from '../userReads';

const ok = (data: unknown): FakeResult => ({ data, error: null });

const USER_ROW = {
  id: 'u_target',
  share_handle: 'target',
  display_name: 'Target',
  biography: null,
  avatar_url: null,
  city_id: 'IL-001',
  privacy_mode: 'Public',
  privacy_changed_at: null,
  verification_level: 0,
  preferred_language: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const STATS_ROW = {
  user_id: 'u_target',
  followers_count: 9,
  following_count: 4,
  items_given_count: 3,
  items_received_count: 2,
  open_posts_public: 6,
  open_posts_followers_only: 1,
  karma_points: 12,
};

const SESSION = {
  user_id: 'u_target',
  account: { status: 'active', onboarding_state: 'completed' },
  private_profile: { contact_phone: '050-9999999', date_of_birth: '1990-05-15', notification_preferences: {} },
  admin: { roles: [] },
};

function tables(row: unknown = USER_ROW) {
  return {
    users: ok(row),
    cities: ok([{ city_id: 'IL-001', name_he: 'Tel Aviv' }]),
    user_stats: ok([STATS_ROW]),
  };
}

describe('fetchUserBy', () => {
  it('selects the public columns by id and joins city name and counters', async () => {
    const { client, calls } = createFakeClient({ tables: tables(), userId: 'u_viewer' });

    const user = await fetchUserBy(client, 'id', 'u_target');

    const read = callsTo(calls, 'users')[0];
    expect(read?.columns).toBe(USER_COLUMNS);
    expect(read?.filters).toContainEqual(['eq', 'id', 'u_target']);
    expect(read?.single).toBe(true);
    expect(user).toMatchObject({ userId: 'u_target', cityName: 'Tel Aviv', followersCount: 9, karmaPoints: 12 });
    expect(callsTo(calls, 'user_stats')[0]?.columns).toBe(USER_STATS_COLUMNS);
  });

  it('looks a profile up by share_handle', async () => {
    const { client, calls } = createFakeClient({ tables: tables() });

    await fetchUserBy(client, 'share_handle', 'target');

    expect(callsTo(calls, 'users')[0]?.filters).toContainEqual(['eq', 'share_handle', 'target']);
  });

  it('returns null when the profile is not visible (inactive or blocked)', async () => {
    const { client } = createFakeClient({ tables: { users: ok(null) } });

    expect(await fetchUserBy(client, 'id', 'u_gone')).toBeNull();
  });

  it('keeps every private field out of another member\'s profile and never reads the session', async () => {
    const { client, calls } = createFakeClient({
      tables: tables(),
      rpc: { bootstrap_session: ok(SESSION) },
      userId: 'u_viewer',
    });

    const user = await fetchUserBy(client, 'id', 'u_target');

    expect(user).toMatchObject({ contactPhone: null, dateOfBirth: null, isSuperAdmin: false, activePostsCountInternal: 0 });
    expect(callsTo(calls, 'bootstrap_session')).toHaveLength(0);
  });

  it('merges the caller\'s private profile into their own row from bootstrap_session', async () => {
    const { client, calls } = createFakeClient({
      tables: tables(),
      rpc: { bootstrap_session: ok(SESSION) },
      userId: 'u_target',
    });

    const user = await fetchUserBy(client, 'id', 'u_target');

    expect(callsTo(calls, 'bootstrap_session')).toHaveLength(1);
    expect(user).toMatchObject({
      contactPhone: '050-9999999',
      dateOfBirth: '1990-05-15',
      accountStatus: 'active',
      activePostsCountInternal: 7,
    });
  });

  it('reports a missing users table as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      tables: { users: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } } },
    });

    await expect(fetchUserBy(client, 'id', 'x')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('surfaces any other query failure as an error', async () => {
    const { client } = createFakeClient({ tables: { users: { data: null, error: { code: '57014', message: 'timeout' } } } });

    await expect(fetchUserBy(client, 'id', 'x')).rejects.toThrow('timeout');
  });
});

describe('hydrateUsers', () => {
  it('answers three queries for a whole page and keeps the order of the rows', async () => {
    const second = { ...USER_ROW, id: 'u_b', city_id: null };
    const { client, calls } = createFakeClient({
      tables: {
        cities: ok([{ city_id: 'IL-001', name_he: 'Tel Aviv' }]),
        user_stats: ok([{ ...STATS_ROW, user_id: 'u_b', followers_count: 1 }, STATS_ROW]),
      },
    });

    const users = await hydrateUsers(client, [second, USER_ROW]);

    expect(users.map((u) => u.userId)).toEqual(['u_b', 'u_target']);
    expect(users.map((u) => u.cityName)).toEqual([null, 'Tel Aviv']);
    expect(users.map((u) => u.followersCount)).toEqual([1, 9]);
    expect(callsTo(calls, 'cities')).toHaveLength(1);
    expect(callsTo(calls, 'user_stats')).toHaveLength(1);
    expect(callsTo(calls, 'cities')[0]?.filters).toContainEqual(['in', 'city_id', ['IL-001']]);
  });

  it('returns [] without a query for an empty page', async () => {
    const { client, calls } = createFakeClient();

    expect(await hydrateUsers(client, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('sessionUserId', () => {
  it('reads the cached session, null when signed out', async () => {
    expect(await sessionUserId(createFakeClient({ userId: 'u1' }).client)).toBe('u1');
    expect(await sessionUserId(createFakeClient({ userId: null }).client)).toBeNull();
  });
});
