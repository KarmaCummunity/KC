// TD-41 SQL probes against the baseline social graph: the follow edge and the follow request
// are two different things, and only `follow_user` (SECURITY DEFINER) creates either.
//
// Verifies, with real signed-in members so RLS applies exactly as in the app:
//   (a) follow_user on a public profile creates an edge and answers `following`, repeating it
//       changes nothing;
//   (b) follow_user on a private profile files a pending request and answers `requested`: a
//       pending request is NOT an edge (`follows` stays empty);
//   (c) an edge is one-directional;
//   (d) a member cannot follow themselves (`self_follow_forbidden`).
// The post-visibility probes of the old file (FollowersOnly) belong to the posts package and are
// covered by the baseline pgTAP suite 030_posts.
//
// Needs a running stack: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (ci-backend
// exports them from `supabase status`); without them the suite is skipped. Every member is removed
// in afterAll (the auth delete cascades).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContractUsers } from '../../__tests__/contractUsers';

const HAS_STACK = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].every((name) =>
  Boolean(process.env[name]),
);
const CASE_TIMEOUT_MS = 60_000;

describe.skipIf(!HAS_STACK)('SQL probes — follow_user() and the follows / follow_requests split', () => {
  // Built in beforeAll: the harness reads the stack credentials and must not run when they are absent.
  let users: ContractUsers;

  beforeAll(() => {
    users = new ContractUsers();
  });

  afterAll(async () => {
    await users.teardown();
  });

  async function makePrivate(userId: string): Promise<void> {
    const { error } = await users.admin.from('users').update({ privacy_mode: 'Private' }).eq('id', userId);
    if (error) throw new Error(`probe harness: privacy update failed (${error.message})`);
  }

  it('creates an edge on a public profile and is idempotent', async () => {
    const [a, b] = [await users.signInNewUser(), await users.signInNewUser()];

    const first = await a.client.rpc('follow_user', { p_target: b.userId });
    const again = await a.client.rpc('follow_user', { p_target: b.userId });
    const edges = await a.client.from('follows').select('follower_id').eq('followed_id', b.userId);

    expect([first.data, again.data]).toEqual(['following', 'following']);
    expect(edges.data).toEqual([{ follower_id: a.userId }]);
  }, CASE_TIMEOUT_MS);

  it('files a pending request on a private profile and creates no edge', async () => {
    const [a, b] = [await users.signInNewUser(), await users.signInNewUser()];
    await makePrivate(b.userId);

    const answer = await a.client.rpc('follow_user', { p_target: b.userId });
    const edges = await a.client.from('follows').select('follower_id').eq('followed_id', b.userId);
    const requests = await a.client.from('follow_requests').select('status').eq('target_id', b.userId);

    expect(answer.data).toBe('requested');
    expect(edges.data).toEqual([]);
    expect(requests.data).toEqual([{ status: 'pending' }]);
  }, CASE_TIMEOUT_MS);

  it('is one-directional: following B does not make B follow A', async () => {
    const [a, b] = [await users.signInNewUser(), await users.signInNewUser()];
    await a.client.rpc('follow_user', { p_target: b.userId });

    const reverse = await b.client.from('follows').select('follower_id').eq('follower_id', b.userId);

    expect(reverse.data).toEqual([]);
  }, CASE_TIMEOUT_MS);

  it('refuses a self-follow with the stable reason self_follow_forbidden', async () => {
    const a = await users.signInNewUser();

    const answer = await a.client.rpc('follow_user', { p_target: a.userId });

    expect(answer.error?.message).toBe('self_follow_forbidden');
  }, CASE_TIMEOUT_MS);
});
