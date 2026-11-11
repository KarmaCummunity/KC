import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient, type FakeResult } from '../../../__tests__/fakeBaselineClient';
import {
  acceptRequest,
  cancelRequest,
  listPendingRaw,
  listPendingWithUsers,
  rejectRequest,
  sendRequest,
} from '../followRequestMethods';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });
const refusal = (message: string, details?: string): FakeResult => ({
  data: null,
  error: { code: 'P0001', message, details },
});

const REQUEST = (requester: string, createdAt: string) => ({
  requester_id: requester,
  target_id: 'me',
  status: 'pending',
  created_at: createdAt,
  cooldown_until: null,
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

describe('sendRequest', () => {
  it('asks through follow_user and reports the pending request', async () => {
    const { client, calls } = createFakeClient({ rpc: { follow_user: ok('requested') } });

    const request = await sendRequest(client, 'u_a', 'u_b');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'follow_user', args: { p_target: 'u_b' } });
    expect(request).toMatchObject({ requesterId: 'u_a', targetId: 'u_b', status: 'pending', cooldownUntil: null });
  });

  it('reports an accepted request when the profile turned out to be public (the server followed at once)', async () => {
    const { client } = createFakeClient({ rpc: { follow_user: ok('following') } });

    expect((await sendRequest(client, 'u_a', 'u_b')).status).toBe('accepted');
  });

  it('maps the cooldown refusal and keeps the end of the cooldown', async () => {
    const { client } = createFakeClient({
      rpc: { follow_user: refusal('follow_request_cooldown_active', 'cooldown_until=2026-06-01T00:00:00Z') },
    });

    await expect(sendRequest(client, 'u_a', 'u_b')).rejects.toMatchObject({
      code: 'cooldown_active',
      cooldownUntil: '2026-06-01T00:00:00Z',
    });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { follow_user: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(sendRequest(client, 'u_a', 'u_b')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('cancelRequest', () => {
  it('calls follow_request_cancel with p_target', async () => {
    const { client, calls } = createFakeClient();

    await cancelRequest(client, 'me', 'u_b');

    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'follow_request_cancel', args: { p_target: 'u_b' } });
  });

  it('treats a request that is no longer pending as already cancelled', async () => {
    const { client } = createFakeClient({ rpc: { follow_request_cancel: refusal('follow_request_not_pending') } });

    await expect(cancelRequest(client, 'me', 'u_b')).resolves.toBeUndefined();
  });

  it('maps any other refusal to a FollowError', async () => {
    const { client } = createFakeClient({ rpc: { follow_request_cancel: refusal('unauthenticated') } });

    await expect(cancelRequest(client, 'me', 'u_b')).rejects.toMatchObject({ name: 'FollowError', code: 'unknown' });
  });
});

describe('acceptRequest / rejectRequest', () => {
  it('accept calls follow_request_decide with p_requester and p_accept true', async () => {
    const { client, calls } = createFakeClient();

    await acceptRequest(client, 'u_req', 'me');

    expect(calls[0]).toMatchObject({
      kind: 'rpc',
      fn: 'follow_request_decide',
      args: { p_requester: 'u_req', p_accept: true },
    });
  });

  it('reject calls it with p_accept false', async () => {
    const { client, calls } = createFakeClient();

    await rejectRequest(client, 'u_req', 'me');

    expect(calls[0]?.args).toEqual({ p_requester: 'u_req', p_accept: false });
  });

  it('treats a request that is no longer pending as already decided', async () => {
    const { client } = createFakeClient({ rpc: { follow_request_decide: refusal('follow_request_not_pending') } });

    await expect(acceptRequest(client, 'u_req', 'me')).resolves.toBeUndefined();
    await expect(rejectRequest(client, 'u_req', 'me')).resolves.toBeUndefined();
  });

  it('maps account_not_active to a FollowError', async () => {
    const { client } = createFakeClient({ rpc: { follow_request_decide: refusal('account_not_active') } });

    await expect(acceptRequest(client, 'u_req', 'me')).rejects.toMatchObject({ code: 'account_not_active' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { follow_request_decide: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(acceptRequest(client, 'u_req', 'me')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('listPendingRaw', () => {
  it('reads the pending requests addressed to the target, newest first', async () => {
    const { client, calls } = createFakeClient({
      tables: { follow_requests: ok([REQUEST('u_1', '2026-03-01T00:00:00Z')]) },
    });

    const requests = await listPendingRaw(client, 'me');

    expect(requests).toEqual([
      { requesterId: 'u_1', targetId: 'me', status: 'pending', createdAt: '2026-03-01T00:00:00Z', cooldownUntil: null },
    ]);
    expect(calls[0]?.filters).toEqual([
      ['eq', 'target_id', 'me'],
      ['eq', 'status', 'pending'],
      ['order', 'created_at', { ascending: false }],
    ]);
  });
});

describe('listPendingWithUsers', () => {
  const tables = (rows: unknown[], users: unknown[]) => ({
    follow_requests: ok(rows),
    users: ok(users),
    user_stats: ok([]),
    cities: ok([]),
  });

  it('joins each request with its requester and hands out the last created_at as the next cursor', async () => {
    const { client, calls } = createFakeClient({
      tables: tables(
        [REQUEST('u_2', '2026-03-02T00:00:00Z'), REQUEST('u_1', '2026-03-01T00:00:00Z')],
        [USER('u_1'), USER('u_2')],
      ),
    });

    const page = await listPendingWithUsers(client, 'me', 2);

    expect(page.requests.map((r) => r.requester.userId)).toEqual(['u_2', 'u_1']);
    expect(page.nextCursor).toBe('2026-03-01T00:00:00Z');
    expect(calls[0]?.filters).toContainEqual(['limit', 2]);
  });

  it('has no next cursor on a short page and pages with created_at < cursor', async () => {
    const { client, calls } = createFakeClient({
      tables: tables([REQUEST('u_1', '2026-03-01T00:00:00Z')], [USER('u_1')]),
    });

    const page = await listPendingWithUsers(client, 'me', 10, '2026-03-05T00:00:00Z');

    expect(page.nextCursor).toBeNull();
    expect(calls[0]?.filters).toContainEqual(['lt', 'created_at', '2026-03-05T00:00:00Z']);
  });

  it('answers an empty page without a users query', async () => {
    const { client, calls } = createFakeClient({ tables: tables([], []) });

    expect(await listPendingWithUsers(client, 'me', 10)).toEqual({ requests: [], nextCursor: null });
    expect(calls.map((c) => c.table)).toEqual(['follow_requests']);
  });

  it('drops a requester the caller cannot see (inactive or blocked)', async () => {
    const { client } = createFakeClient({
      tables: tables([REQUEST('u_2', '2026-03-02T00:00:00Z'), REQUEST('u_1', '2026-03-01T00:00:00Z')], [USER('u_1')]),
    });

    const page = await listPendingWithUsers(client, 'me', 10);

    expect(page.requests.map((r) => r.requester.userId)).toEqual(['u_1']);
  });

  it('surfaces a failed query', async () => {
    const { client } = createFakeClient({ tables: { follow_requests: { data: null, error: { message: 'timeout' } } } });

    await expect(listPendingWithUsers(client, 'me', 10)).rejects.toThrow('timeout');
  });
});
