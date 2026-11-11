import { describe, it, expect } from 'vitest';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import { USER_COLUMNS } from '../mapUserRow';
import { searchUsers } from '../searchUsers';

const ok = (data: unknown): FakeResult => ({ data, error: null });

const ROW = {
  id: 'u_a',
  share_handle: 'alice',
  display_name: 'Alice',
  biography: null,
  avatar_url: null,
  city_id: null,
  privacy_mode: 'Public',
  privacy_changed_at: null,
  verification_level: 1,
  preferred_language: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const withUsers = (rows: unknown) =>
  createFakeClient({ tables: { users: ok(rows), user_stats: ok([]), cities: ok([]) }, userId: 'u_me' });

const usersCall = (calls: ReturnType<typeof createFakeClient>['calls']) => callsTo(calls, 'users')[0];

describe('searchUsers — query length gating', () => {
  it('returns [] without calling the DB for an empty query', async () => {
    const { client, calls } = withUsers([]);

    expect(await searchUsers(client, '', { excludeUserId: 'u_me', limit: 10 })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns [] without calling the DB for a single character (after trim)', async () => {
    const { client, calls } = withUsers([]);

    expect(await searchUsers(client, '  a ', { excludeUserId: 'u_me', limit: 10 })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('searchUsers — query shape', () => {
  it('selects the public columns with an OR ILIKE clause across display_name + share_handle', async () => {
    const { client, calls } = withUsers([]);

    await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    expect(usersCall(calls)?.columns).toBe(USER_COLUMNS);
    expect(usersCall(calls)?.filters).toContainEqual(['or', 'display_name.ilike."%ali%",share_handle.ilike."%ali%"']);
  });

  it('escapes ILIKE wildcards %, _, \\ then quote-wraps before interpolation', async () => {
    const { client, calls } = withUsers([]);

    await searchUsers(client, '50%_off\\', { excludeUserId: 'u_me', limit: 10 });

    expect(usersCall(calls)?.filters).toContainEqual([
      'or',
      String.raw`display_name.ilike."%50\\%\\_off\\\\%",share_handle.ilike."%50\\%\\_off\\\\%"`,
    ]);
  });

  it('quotes an injected comma/predicate so it stays inside the value (CWE-943)', async () => {
    const { client, calls } = withUsers([]);

    await searchUsers(client, 'x,city.eq.IL', { excludeUserId: 'u_me', limit: 10 });

    expect(usersCall(calls)?.filters).toContainEqual([
      'or',
      'display_name.ilike."%x,city.eq.IL%",share_handle.ilike."%x,city.eq.IL%"',
    ]);
  });

  it('excludes the caller from results via neq(id, excludeUserId)', async () => {
    const { client, calls } = withUsers([]);

    await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    expect(usersCall(calls)?.filters).toContainEqual(['neq', 'id', 'u_me']);
  });

  it('does not read blocks: the restrictive policy users_hide_blocked already hides blocked members', async () => {
    const { client, calls } = withUsers([]);

    await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    expect(callsTo(calls, 'blocks')).toHaveLength(0);
  });

  it.each([
    [25, 25],
    [999, 50],
    [0, 1],
    [-5, 1],
  ])('limit %i is sent as %i', async (asked, sent) => {
    const { client, calls } = withUsers([]);

    await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: asked });

    expect(usersCall(calls)?.filters).toContainEqual(['limit', sent]);
  });
});

describe('searchUsers — result shape + error path', () => {
  it('maps the rows to domain users with private fields neutral', async () => {
    const { client } = withUsers([ROW]);

    const users = await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      userId: 'u_a',
      shareHandle: 'alice',
      displayName: 'Alice',
      verificationLevel: 1,
      contactPhone: null,
      isSuperAdmin: false,
    });
  });

  it('returns [] when the query answers null data', async () => {
    const { client } = withUsers(null);

    expect(await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 })).toEqual([]);
  });

  it('surfaces a query failure', async () => {
    const { client } = createFakeClient({ tables: { users: { data: null, error: { message: 'timeout' } } } });

    await expect(searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 })).rejects.toThrow('timeout');
  });
});
