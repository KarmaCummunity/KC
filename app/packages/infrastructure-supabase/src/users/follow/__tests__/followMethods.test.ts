import { describe, it, expect } from 'vitest';
import { FollowError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall, type FakeResult } from '../../../__tests__/fakeBaselineClient';
import { followEdge, isFollowingEdge, listFollowers, listFollowing, unfollowEdge } from '../followMethods';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });
const refusal = (message: string, details?: string): FakeResult => ({
  data: null,
  error: { code: 'P0001', message, details },
});

const USER = (id: string) => ({
  id,
  share_handle: `h_${id}`,
  display_name: `Name ${id}`,
  biography: null,
  avatar_url: null,
  city_id: null,
  privacy_mode: 'Public',
  privacy_changed_at: null,
  verification_level: 0,
  preferred_language: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('followEdge', () => {
  it('calls follow_user with p_target and returns an edge on a public profile', async () => {
    const { client, calls } = createFakeClient({ rpc: { follow_user: ok('following') } });

    const edge = await followEdge(client, 'u_a', 'u_b');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'follow_user', args: { p_target: 'u_b' } });
    expect(edge).toMatchObject({ followerId: 'u_a', followedId: 'u_b' });
    expect(Number.isNaN(Date.parse(edge.createdAt))).toBe(false);
  });

  it('is idempotent: the server answers `following` again for an existing edge', async () => {
    const { client } = createFakeClient({ rpc: { follow_user: ok('following') } });

    await followEdge(client, 'u_a', 'u_b');
    await expect(followEdge(client, 'u_a', 'u_b')).resolves.toMatchObject({ followedId: 'u_b' });
  });

  it('refuses a direct follow of a private profile with request_required (the server filed a request)', async () => {
    const { client } = createFakeClient({ rpc: { follow_user: ok('requested') } });

    const error = await followEdge(client, 'u_a', 'u_b').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FollowError);
    expect(error).toMatchObject({ code: 'request_required' });
  });

  it.each([
    ['self_follow_forbidden', 'self_follow'],
    ['blocked_relationship', 'blocked_relationship'],
    ['account_not_active', 'account_not_active'],
    ['rate_limited', 'rate_limited'],
    ['user_unavailable', 'user_not_found'],
  ])('maps the refusal %s to FollowError(%s)', async (reason, code) => {
    const { client } = createFakeClient({ rpc: { follow_user: refusal(reason) } });

    await expect(followEdge(client, 'u_a', 'u_b')).rejects.toMatchObject({ name: 'FollowError', code });
  });

  it('carries the end of a cooldown from the refusal detail', async () => {
    const { client } = createFakeClient({
      rpc: { follow_user: refusal('follow_request_cooldown_active', 'cooldown_until=2026-06-01T00:00:00Z') },
    });

    await expect(followEdge(client, 'u_a', 'u_b')).rejects.toMatchObject({
      code: 'cooldown_active',
      cooldownUntil: '2026-06-01T00:00:00Z',
    });
  });

  it('reports a missing follow_user as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { follow_user: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(followEdge(client, 'u_a', 'u_b')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('rejects an answer that is neither following nor requested', async () => {
    const { client } = createFakeClient({ rpc: { follow_user: ok('maybe') } });

    await expect(followEdge(client, 'u_a', 'u_b')).rejects.toThrow('unexpected answer');
  });
});

describe('unfollowEdge / isFollowingEdge', () => {
  it('deletes the edge from follows by both ids', async () => {
    const { client, calls } = createFakeClient();

    await unfollowEdge(client, 'u_a', 'u_b');

    expect(calls[0]).toMatchObject({ kind: 'delete', table: 'follows' });
    expect(calls[0]?.filters).toEqual([['eq', 'follower_id', 'u_a'], ['eq', 'followed_id', 'u_b']]);
  });

  it('surfaces a failed delete', async () => {
    const { client } = createFakeClient({ tables: { follows: { data: null, error: { message: 'rls' } } } });

    await expect(unfollowEdge(client, 'u_a', 'u_b')).rejects.toThrow('rls');
  });

  it('reads whether the edge exists', async () => {
    const yes = createFakeClient({ tables: { follows: ok({ follower_id: 'u_a' }) } });
    const no = createFakeClient({ tables: { follows: ok(null) } });

    expect(await isFollowingEdge(yes.client, 'u_a', 'u_b')).toBe(true);
    expect(await isFollowingEdge(no.client, 'u_a', 'u_b')).toBe(false);
    expect(yes.calls[0]?.filters).toEqual([['eq', 'follower_id', 'u_a'], ['eq', 'followed_id', 'u_b']]);
  });
});

describe('listFollowers / listFollowing', () => {
  function listClient(edges: unknown[], users: unknown[]) {
    return createFakeClient({
      tables: {
        follows: (call: FakeCall) => ok(call.single ? { created_at: '2026-03-01T00:00:00Z' } : edges),
        users: ok(users),
        user_stats: ok([]),
        cities: ok([]),
      },
    });
  }

  it('lists the followers newest edge first, in the order of the edges', async () => {
    const { client, calls } = listClient(
      [
        { follower_id: 'u_2', followed_id: 'me', created_at: '2026-03-02T00:00:00Z' },
        { follower_id: 'u_1', followed_id: 'me', created_at: '2026-03-01T00:00:00Z' },
      ],
      [USER('u_1'), USER('u_2')],
    );

    const users = await listFollowers(client, 'me', 50);

    expect(users.map((u) => u.userId)).toEqual(['u_2', 'u_1']);
    expect(calls[0]?.filters).toEqual([
      ['eq', 'followed_id', 'me'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 50],
    ]);
    expect(callsTo(calls, 'users')[0]?.filters).toContainEqual(['in', 'id', ['u_2', 'u_1']]);
  });

  it('lists the members a member follows from the followed end', async () => {
    const { client, calls } = listClient(
      [{ follower_id: 'me', followed_id: 'u_9', created_at: '2026-03-02T00:00:00Z' }],
      [USER('u_9')],
    );

    const users = await listFollowing(client, 'me', 20);

    expect(users.map((u) => u.userId)).toEqual(['u_9']);
    expect(calls[0]?.filters).toContainEqual(['eq', 'follower_id', 'me']);
  });

  it('continues after the edge of the cursor member (keyset on created_at)', async () => {
    const { client, calls } = listClient([], []);

    await listFollowers(client, 'me', 10, 'u_5');

    const cursorLookup = callsTo(calls, 'follows')[0];
    expect(cursorLookup?.single).toBe(true);
    expect(cursorLookup?.filters).toEqual([['eq', 'followed_id', 'me'], ['eq', 'follower_id', 'u_5']]);
    expect(callsTo(calls, 'follows')[1]?.filters).toContainEqual(['lt', 'created_at', '2026-03-01T00:00:00Z']);
  });

  it('leaves out members the caller cannot see (inactive or blocked)', async () => {
    const { client } = listClient(
      [
        { follower_id: 'u_2', followed_id: 'me', created_at: '2026-03-02T00:00:00Z' },
        { follower_id: 'u_1', followed_id: 'me', created_at: '2026-03-01T00:00:00Z' },
      ],
      [USER('u_1')],
    );

    expect((await listFollowers(client, 'me', 50)).map((u) => u.userId)).toEqual(['u_1']);
  });

  it('returns [] without a users query when there are no edges', async () => {
    const { client, calls } = listClient([], []);

    expect(await listFollowers(client, 'me', 50)).toEqual([]);
    expect(callsTo(calls, 'users')).toHaveLength(0);
  });

  it('surfaces a failed edge query', async () => {
    const { client } = createFakeClient({ tables: { follows: { data: null, error: { message: 'timeout' } } } });

    await expect(listFollowers(client, 'me', 50)).rejects.toThrow('timeout');
  });
});
