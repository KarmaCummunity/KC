import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, isAdminContentError } from '@kc/domain';
import { SupabaseAdminContentRepository } from '../SupabaseAdminContentRepository';
import { chainHas, fakeStaffClient, type FakeResult } from '../../__tests__/fakeStaffClient';

const ok = (data: unknown): FakeResult => ({ data, error: null });
const refuse = (message: string, code: string): FakeResult => ({ data: null, error: { code, message } });

function repoWith(options: Parameters<typeof fakeStaffClient>[0] = {}) {
  const fake = fakeStaffClient(options);
  return { ...fake, repo: new SupabaseAdminContentRepository(fake.client) };
}

const userRow = (i: number, over: Record<string, unknown> = {}) => ({
  id: `u${i}`,
  display_name: `User ${i}`,
  share_handle: `user${i}`,
  city_id: 'tel-aviv',
  created_at: `2026-03-0${i}T10:00:00.000Z`,
  user_account: { status: 'banned' },
  ...over,
});

describe('SupabaseAdminContentRepository.searchUsers', () => {
  it('reads users with their account status under the staff policies, newest first', async () => {
    const { repo, chains } = repoWith({ tables: { users: ok([userRow(1)]) } });

    const page = await repo.searchUsers({});

    expect(chains[0]?.table).toBe('users');
    expect(chains[0]?.calls[0]).toEqual([
      'select', ['id, display_name, share_handle, city_id, created_at, user_account!inner(status)'],
    ]);
    expect(chainHas(chains[0]!, 'order', 'created_at', { ascending: false })).toBe(true);
    expect(chainHas(chains[0]!, 'limit', 51)).toBe(true);
    expect(page.rows[0]).toMatchObject({
      userId: 'u1', displayName: 'User 1', shareHandle: 'user1', accountStatus: 'banned', cityId: 'tel-aviv',
    });
    expect(page.rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(page.nextCursor).toBeNull();
  });

  it('filters by account status and by a sanitized name / handle pattern', async () => {
    const { repo, chains } = repoWith({ tables: { users: ok([]) } });

    await repo.searchUsers({ status: 'suspended_admin', query: 'al,i(c)e%' });

    expect(chainHas(chains[0]!, 'eq', 'user_account.status', 'suspended_admin')).toBe(true);
    expect(chainHas(chains[0]!, 'or', 'display_name.ilike.%al i c e%,share_handle.ilike.%al i c e%')).toBe(true);
  });

  it('returns a keyset cursor when a further page exists and resumes after it', async () => {
    const { repo, chains } = repoWith({ tables: { users: ok([userRow(3), userRow(2), userRow(1)]) } });

    const page = await repo.searchUsers({ limit: 2 });

    expect(page.rows.map((r) => r.userId)).toEqual(['u3', 'u2']);
    expect(page.nextCursor).toEqual({ createdAt: '2026-03-02T10:00:00.000Z', id: 'u2' });

    await repo.searchUsers({ limit: 2, cursor: page.nextCursor });
    expect(chainHas(
      chains[1]!, 'or',
      'created_at.lt.2026-03-02T10:00:00.000Z,and(created_at.eq.2026-03-02T10:00:00.000Z,id.lt.u2)',
    )).toBe(true);
  });

  it('reads the account of an array-shaped embed too', async () => {
    const { repo } = repoWith({ tables: { users: ok([userRow(1, { user_account: [{ status: 'active' }] })]) } });

    expect((await repo.searchUsers({})).rows[0]?.accountStatus).toBe('active');
  });

  it('maps a refusal to AdminContentError("forbidden")', async () => {
    const { repo } = repoWith({ tables: { users: refuse('permission denied', '42501') } });

    const err = await repo.searchUsers({}).catch((e: unknown) => e);

    expect(isAdminContentError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'forbidden' });
  });

  it('degrades to BackendUnavailableError when the table is missing', async () => {
    const { repo } = repoWith({ tables: { users: refuse('missing', 'PGRST205') } });

    await expect(repo.searchUsers({})).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseAdminContentRepository.findActiveMembers', () => {
  it('reads active members by a sanitized display-name pattern', async () => {
    const { repo, chains } = repoWith({ tables: { users: ok([{ id: 'u1', display_name: 'Dana' }]) } });

    const found = await repo.findActiveMembers('da,na', 8);

    expect(found).toEqual([{ userId: 'u1', displayName: 'Dana' }]);
    expect(chains[0]?.calls).toEqual(expect.arrayContaining([
      ['select', ['id, display_name']],
      ['eq', ['is_active', true]],
      ['ilike', ['display_name', '%da na%']],
      ['limit', [8]],
    ]));
  });

  it('degrades to BackendUnavailableError when the table is missing', async () => {
    const { repo } = repoWith({ tables: { users: refuse('missing', 'PGRST205') } });

    await expect(repo.findActiveMembers('dana', 8)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseAdminContentRepository.searchPosts', () => {
  const postRow = (i: number) => ({
    id: `p${i}`, title: `Post ${i}`, post_type: 'item', status: 'removed_admin', visibility: 'Public',
    owner_id: `o${i}`, created_at: `2026-04-0${i}T10:00:00.000Z`, updated_at: `2026-04-0${i}T11:00:00.000Z`,
  });

  it('reads posts in any status and attaches the owner names', async () => {
    const { repo, chains } = repoWith({
      tables: { posts: ok([postRow(1)]), users: ok([{ id: 'o1', display_name: 'Owner' }]) },
    });

    const page = await repo.searchPosts({ status: 'removed_admin', query: 'sofa' });

    expect(chains[0]?.table).toBe('posts');
    expect(chainHas(chains[0]!, 'eq', 'status', 'removed_admin')).toBe(true);
    expect(chainHas(chains[0]!, 'or', 'title.ilike.%sofa%,description.ilike.%sofa%')).toBe(true);
    expect(page.rows[0]).toMatchObject({
      postId: 'p1', title: 'Post 1', type: 'item', status: 'removed_admin', visibility: 'Public',
      ownerId: 'o1', ownerDisplayName: 'Owner',
    });
    expect(page.nextCursor).toBeNull();
  });

  it('pages by keyset and leaves the owner name null when the member is unreadable', async () => {
    const { repo } = repoWith({ tables: { posts: ok([postRow(2), postRow(1)]), users: ok([]) } });

    const page = await repo.searchPosts({ limit: 1 });

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.ownerDisplayName).toBeNull();
    expect(page.nextCursor).toEqual({ createdAt: '2026-04-02T10:00:00.000Z', id: 'p2' });
  });

  it('maps a refusal to forbidden', async () => {
    const { repo } = repoWith({ tables: { posts: refuse('permission denied', '42501') } });

    await expect(repo.searchPosts({})).rejects.toMatchObject({ name: 'AdminContentError', code: 'forbidden' });
  });
});

describe('SupabaseAdminContentRepository.searchAudit', () => {
  const event = (id: number, over: Record<string, unknown> = {}) => ({
    id, occurred_at: `2026-05-${10 + id}T08:00:00.000Z`, actor_id: 'a1', action: 'ban_user',
    target_type: 'user', target_id: 't1', metadata: { reason: 'spam' }, ...over,
  });

  it('calls admin_audit_search with the new argument names and one extra row', async () => {
    const { repo, rpcCalls } = repoWith({
      rpc: { admin_audit_search: ok([event(1)]) },
      tables: { users: ok([{ id: 'a1', display_name: 'Admin' }, { id: 't1', display_name: 'Target' }]) },
    });

    const page = await repo.searchAudit({
      targetUserId: 't1', actorId: 'a1', action: 'ban_user',
      fromDate: new Date('2026-05-01T00:00:00.000Z'), toDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(rpcCalls).toEqual([{
      name: 'admin_audit_search',
      args: {
        p_limit: 101, p_target_id: 't1', p_actor_id: 'a1', p_action: 'ban_user',
        p_from: '2026-05-01T00:00:00.000Z', p_to: '2026-06-01T00:00:00.000Z',
      },
    }]);
    expect(page.rows[0]).toMatchObject({
      eventId: '1', actorId: 'a1', actorDisplayName: 'Admin', action: 'ban_user',
      targetType: 'user', targetId: 't1', targetDisplayName: 'Target', metadata: { reason: 'spam' },
    });
    expect(page.rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(page.nextCursor).toBeNull();
  });

  it('sends no optional argument that was not asked for', async () => {
    const { repo, rpcCalls } = repoWith({ rpc: { admin_audit_search: ok([]) } });

    await repo.searchAudit({});

    expect(rpcCalls[0]?.args).toEqual({ p_limit: 101 });
  });

  it('pages by (occurred_at, id) keyset', async () => {
    const { repo, rpcCalls } = repoWith({
      rpc: { admin_audit_search: ok([event(3), event(2), event(1)]) },
      tables: { users: ok([]) },
    });

    const page = await repo.searchAudit({ limit: 2 });

    expect(page.rows.map((r) => r.eventId)).toEqual(['3', '2']);
    expect(page.nextCursor).toEqual({ occurredAt: '2026-05-12T08:00:00.000Z', id: 2 });

    await repo.searchAudit({ limit: 2, cursor: page.nextCursor });
    expect(rpcCalls[1]?.args).toMatchObject({ p_before_occurred_at: '2026-05-12T08:00:00.000Z', p_before_id: 2 });
  });

  it('clamps the page size to what the server serves and names only member targets', async () => {
    const { repo, rpcCalls, chains } = repoWith({
      rpc: { admin_audit_search: ok([event(1, { actor_id: null, target_type: 'post', metadata: null })]) },
    });

    const page = await repo.searchAudit({ limit: 5000 });

    expect((rpcCalls[0]?.args as { p_limit: number }).p_limit).toBe(200);
    expect(page.rows[0]).toMatchObject({ actorId: null, actorDisplayName: null, targetDisplayName: null, metadata: {} });
    expect(chains).toHaveLength(0);
  });

  it('maps a refusal (a role without audit access) to forbidden', async () => {
    const { repo } = repoWith({ rpc: { admin_audit_search: refuse('forbidden', '42501') } });

    await expect(repo.searchAudit({})).rejects.toMatchObject({ name: 'AdminContentError', code: 'forbidden' });
  });

  it('degrades to BackendUnavailableError when the RPC is missing', async () => {
    const { repo } = repoWith({ rpc: { admin_audit_search: refuse('missing', 'PGRST202') } });

    await expect(repo.searchAudit({})).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
