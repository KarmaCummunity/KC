import { describe, expect, it } from 'vitest';
import { AdminRoleError, BackendUnavailableError, isAdminRoleError } from '@kc/domain';
import { SupabaseAdminRoleRepository } from '../SupabaseAdminRoleRepository';
import { fakeStaffClient, type FakeResult } from '../../__tests__/fakeStaffClient';

const ok = (data: unknown): FakeResult => ({ data, error: null });
const refuse = (message: string, code: string): FakeResult => ({ data: null, error: { code, message } });

/** A repository whose RPCs and tables resolve as configured. */
function repoWith(options: Parameters<typeof fakeStaffClient>[0] = {}) {
  const fake = fakeStaffClient(options);
  return { ...fake, repo: new SupabaseAdminRoleRepository(fake.client) };
}

const grantRow = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  user_id: 'u1',
  role: 'moderator',
  scope_org_id: null,
  is_platform: true,
  manager_grant_id: null,
  granted_by: 'super-1',
  granted_at: '2026-01-01T00:00:00.000Z',
  revoked_at: null,
  revoked_by: null,
  ...over,
});

describe('SupabaseAdminRoleRepository — role RPCs', () => {
  it('grantRole returns the grant id and sends the org only for an org role', async () => {
    const { repo, rpcCalls } = repoWith({ rpc: { admin_grant_role: ok('grant-1') } });

    expect(await repo.grantRole('u1', 'org_volunteer', 'org-a')).toBe('grant-1');
    await repo.grantRole('u1', 'support', null);

    expect(rpcCalls[0]).toEqual({
      name: 'admin_grant_role',
      args: { p_target_user_id: 'u1', p_role: 'org_volunteer', p_scope_org_id: 'org-a' },
    });
    expect(rpcCalls[1]?.args).toEqual({ p_target_user_id: 'u1', p_role: 'support' });
  });

  it.each([
    ['role_already_active', 'P0001'],
    ['target_not_found', 'P0001'],
    ['target_not_active', 'P0001'],
    ['invalid_role', 'P0001'],
    ['invalid_scope', 'P0001'],
    ['forbidden_grant', '42501'],
  ])('grantRole maps the stable refusal %s (%s)', async (message, sqlstate) => {
    const { repo } = repoWith({ rpc: { admin_grant_role: refuse(message, sqlstate) } });

    await expect(repo.grantRole('u1', 'moderator', null)).rejects.toMatchObject({ code: message });
  });

  it('grantRole maps an opaque 42501 (RLS or grant) to forbidden', async () => {
    const { repo } = repoWith({ rpc: { admin_grant_role: refuse('something went wrong', '42501') } });

    await expect(repo.grantRole('u1', 'moderator', null)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('grantRole maps unauthenticated to forbidden and an unknown failure to unknown', async () => {
    const signedOut = repoWith({ rpc: { admin_grant_role: refuse('unauthenticated', '42501') } });
    await expect(signedOut.repo.grantRole('u1', 'moderator', null)).rejects.toMatchObject({ code: 'forbidden' });

    const weird = repoWith({ rpc: { admin_grant_role: refuse('weird', '99999') } });
    await expect(weird.repo.grantRole('u1', 'moderator', null)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('grantRole degrades to BackendUnavailableError when the RPC is not deployed', async () => {
    const { repo } = repoWith({ rpc: { admin_grant_role: refuse('Could not find the function', 'PGRST202') } });

    const failure = await repo.grantRole('u1', 'moderator', null).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(BackendUnavailableError);
    expect(failure).toMatchObject({ object: 'rpc:admin_grant_role' });
  });

  it('revokeRole resolves to void and calls admin_revoke_role(p_grant_id)', async () => {
    const { repo, rpcCalls } = repoWith({ rpc: { admin_revoke_role: ok(null) } });

    await expect(repo.revokeRole('g1')).resolves.toBeUndefined();
    expect(rpcCalls).toEqual([{ name: 'admin_revoke_role', args: { p_grant_id: 'g1' } }]);
  });

  it.each([
    ['grant_not_found', 'P0001'],
    ['grant_already_revoked', 'P0001'],
    ['forbidden_revoke', '42501'],
  ])('revokeRole maps %s', async (message, sqlstate) => {
    const { repo } = repoWith({ rpc: { admin_revoke_role: refuse(message, sqlstate) } });

    const err = await repo.revokeRole('g1').catch((e: unknown) => e);

    expect(isAdminRoleError(err)).toBe(true);
    expect((err as AdminRoleError).code).toBe(message);
  });

  it('changeRole calls admin_change_role and returns the new grant id', async () => {
    const { repo, rpcCalls } = repoWith({ rpc: { admin_change_role: ok('grant-2') } });

    expect(await repo.changeRole('g1', 'org_manager')).toBe('grant-2');
    expect(rpcCalls).toEqual([{ name: 'admin_change_role', args: { p_grant_id: 'g1', p_new_role: 'org_manager' } }]);
  });

  it('changeRole maps role_already_active and rejects a non-string result', async () => {
    const dup = repoWith({ rpc: { admin_change_role: refuse('role_already_active', 'P0001') } });
    await expect(dup.repo.changeRole('g1', 'org_employee')).rejects.toMatchObject({ code: 'role_already_active' });

    const odd = repoWith({ rpc: { admin_change_role: ok(42) } });
    await expect(odd.repo.changeRole('g1', 'org_employee')).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('SupabaseAdminRoleRepository — listAdmins (direct staff read)', () => {
  const people = [
    { id: 'u1', display_name: 'Alice', avatar_url: 'a.png' },
    { id: 'super-1', display_name: 'Root', avatar_url: null },
  ];

  it('reads active grants joined to member names, and parses timestamps', async () => {
    const { repo, chains } = repoWith({
      tables: { admin_role_grants: ok([grantRow()]), users: ok(people) },
    });

    const out = await repo.listAdmins(false);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      grantId: 'g1', userId: 'u1', role: 'moderator', displayName: 'Alice', avatarUrl: 'a.png',
      scopeOrgId: null, grantedByDisplayName: 'Root', revokedAt: null, lastSeenAt: null,
    });
    expect(out[0]?.grantedAt).toBeInstanceOf(Date);
    const grants = chains.find((c) => c.table === 'admin_role_grants');
    expect(grants?.calls).toEqual(expect.arrayContaining([['is', ['revoked_at', null]]]));
    const users = chains.find((c) => c.table === 'users');
    expect(users?.calls).toEqual(expect.arrayContaining([['in', ['id', ['u1', 'super-1']]]]));
  });

  it('includes revoked grants (no revoked_at filter) when asked', async () => {
    const { repo, chains } = repoWith({
      tables: { admin_role_grants: ok([grantRow({ revoked_at: '2026-02-01T00:00:00.000Z', revoked_by: 'super-1' })]), users: ok(people) },
    });

    const out = await repo.listAdmins(true);

    expect(out[0]?.revokedAt).toBeInstanceOf(Date);
    expect(chains[0]?.calls.some(([m]) => m === 'is')).toBe(false);
  });

  it('maps the grant scope', async () => {
    const { repo } = repoWith({
      tables: { admin_role_grants: ok([grantRow({ role: 'org_admin', scope_org_id: 'org-a', is_platform: false })]), users: ok(people) },
    });

    expect((await repo.listAdmins(false))[0]?.scopeOrgId).toBe('org-a');
  });

  it('drops rows with an unparseable role', async () => {
    const { repo } = repoWith({
      tables: { admin_role_grants: ok([grantRow({ role: 'not_a_real_role' })]), users: ok(people) },
    });

    expect(await repo.listAdmins(false)).toEqual([]);
  });

  it('returns an empty list for no grants, without reading users', async () => {
    const { repo, chains } = repoWith({ tables: { admin_role_grants: ok(null) } });

    expect(await repo.listAdmins(false)).toEqual([]);
    expect(chains.map((c) => c.table)).toEqual(['admin_role_grants']);
  });

  it('maps a refusal to forbidden', async () => {
    const { repo } = repoWith({ tables: { admin_role_grants: refuse('permission denied', '42501') } });

    await expect(repo.listAdmins(false)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('degrades to BackendUnavailableError when the table is not deployed', async () => {
    const { repo } = repoWith({ tables: { admin_role_grants: refuse("Could not find the table 'public.admin_role_grants'", 'PGRST205') } });

    await expect(repo.listAdmins(false)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseAdminRoleRepository — getMyRoles', () => {
  it('parses get_my_admin_roles and drops unknown values', async () => {
    const { repo, rpcCalls } = repoWith({ rpc: { get_my_admin_roles: ok(['moderator', 'support', 'nope']) } });

    expect(await repo.getMyRoles()).toEqual(['moderator', 'support']);
    expect(rpcCalls[0]?.name).toBe('get_my_admin_roles');
  });

  it('throws BackendUnavailableError when the function is missing', async () => {
    const { repo } = repoWith({ rpc: { get_my_admin_roles: refuse('missing', 'PGRST202') } });

    await expect(repo.getMyRoles()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
