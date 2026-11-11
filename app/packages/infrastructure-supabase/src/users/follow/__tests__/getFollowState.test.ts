import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall, type FakeResult } from '../../../__tests__/fakeBaselineClient';
import { fetchFollowStateRaw } from '../getFollowState';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });

/** follow_requests answers per status filter: the pending probe and the cooldown probe. */
function requests(pending: unknown, cooldown: unknown) {
  return (call: FakeCall): FakeResult => {
    const status = call.filters.find((f) => f[0] === 'eq' && f[1] === 'status')?.[2];
    return ok(status === 'pending' ? pending : cooldown);
  };
}

describe('fetchFollowStateRaw', () => {
  it('runs the four probes against users, follows and follow_requests', async () => {
    const { client, calls } = createFakeClient({
      tables: { users: ok({ id: 'u_t', privacy_mode: 'Public' }), follows: ok(null), follow_requests: requests(null, null) },
    });

    await fetchFollowStateRaw(client, 'viewer', 'u_t');

    expect(calls.map((c) => c.table).sort()).toEqual(['follow_requests', 'follow_requests', 'follows', 'users']);
    expect(callsTo(calls, 'users')[0]?.filters).toEqual([['eq', 'id', 'u_t']]);
    expect(callsTo(calls, 'follows')[0]?.filters).toEqual([
      ['eq', 'follower_id', 'viewer'],
      ['eq', 'followed_id', 'u_t'],
    ]);
  });

  it('describes a visible public target the viewer follows (a visible target is active)', async () => {
    const { client } = createFakeClient({
      tables: {
        users: ok({ id: 'u_t', privacy_mode: 'Public' }),
        follows: ok({ follower_id: 'viewer' }),
        follow_requests: requests(null, null),
      },
    });

    expect(await fetchFollowStateRaw(client, 'viewer', 'u_t')).toEqual({
      target: { userId: 'u_t', privacyMode: 'Public', accountStatus: 'active' },
      followingExists: true,
      pendingRequestExists: false,
      cooldownUntil: null,
    });
  });

  it('reports a pending request and the end of a rejection cooldown', async () => {
    const { client } = createFakeClient({
      tables: {
        users: ok({ id: 'u_t', privacy_mode: 'Private' }),
        follows: ok(null),
        follow_requests: requests({ requester_id: 'viewer' }, { cooldown_until: '2026-06-14T00:00:00Z' }),
      },
    });

    expect(await fetchFollowStateRaw(client, 'viewer', 'u_t')).toMatchObject({
      target: { privacyMode: 'Private' },
      pendingRequestExists: true,
      cooldownUntil: '2026-06-14T00:00:00Z',
    });
  });

  it('reads only unexpired rejections for the cooldown', async () => {
    const { client, calls } = createFakeClient({
      tables: { users: ok(null), follows: ok(null), follow_requests: requests(null, null) },
    });

    await fetchFollowStateRaw(client, 'viewer', 'u_t');

    const cooldown = callsTo(calls, 'follow_requests').find((c) => c.columns === 'cooldown_until');
    expect(cooldown?.filters).toContainEqual(['eq', 'status', 'rejected']);
    expect(cooldown?.filters.find((f) => f[0] === 'gt')?.[1]).toBe('cooldown_until');
  });

  it('reports a null target when the profile is not visible (inactive or blocked)', async () => {
    const { client } = createFakeClient({
      tables: { users: ok(null), follows: ok(null), follow_requests: requests(null, null) },
    });

    expect((await fetchFollowStateRaw(client, 'viewer', 'u_t')).target).toBeNull();
  });

  it('collapses an unknown privacy mode to Public', async () => {
    const { client } = createFakeClient({
      tables: { users: ok({ id: 'u_t', privacy_mode: 'Followers' }), follows: ok(null), follow_requests: requests(null, null) },
    });

    expect((await fetchFollowStateRaw(client, 'viewer', 'u_t')).target?.privacyMode).toBe('Public');
  });

  it('reports a missing follows table as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      tables: {
        users: ok({ id: 'u_t', privacy_mode: 'Public' }),
        follows: { data: null, error: { code: 'PGRST205', message: 'not found' } },
        follow_requests: requests(null, null),
      },
    });

    await expect(fetchFollowStateRaw(client, 'viewer', 'u_t')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
