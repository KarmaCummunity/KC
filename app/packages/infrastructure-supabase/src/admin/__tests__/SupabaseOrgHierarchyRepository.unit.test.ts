// FR-ADMIN-028 — the staff hierarchy built on the device from the baseline grants.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, isOrgHierarchyError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseOrgHierarchyRepository } from '../SupabaseOrgHierarchyRepository';

const GRANTS = [
  { id: 'g0', user_id: 'u0', role: 'super_admin', scope_org_id: null, manager_grant_id: null },
  { id: 'g1', user_id: 'u1', role: 'org_admin', scope_org_id: 'org-1', manager_grant_id: 'g0' },
  { id: 'g2', user_id: 'u1', role: 'mystery', scope_org_id: 'org-1', manager_grant_id: null },
];
const ORGS = [
  { id: 'org-1', name: 'Org One', is_platform: false, is_verified_nonprofit: true },
  { id: 'kc', name: 'Karma Community', is_platform: true, is_verified_nonprofit: false },
];
const MEMBERS = [{ id: 'u0', display_name: 'Root', avatar_url: null }, { id: 'u1', display_name: 'Alice', avatar_url: 'a.png' }];

const repoOf = (config: FakeClientConfig = {}) => {
  const fake = createFakeClient({
    ...config,
    tables: { admin_role_grants: ok(GRANTS), organizations: ok(ORGS), users: ok(MEMBERS), ...config.tables },
  });
  return { ...fake, repo: new SupabaseOrgHierarchyRepository(fake.client) };
};

describe('SupabaseOrgHierarchyRepository — getOrgTree', () => {
  it('builds the nodes from the active grants, platform roles under the platform organization', async () => {
    const { repo, calls } = repoOf();
    const tree = await repo.getOrgTree(null);
    expect(tree.map((n) => [n.grantId, n.orgId, n.orgName, n.isPlatform, n.displayName])).toEqual([
      ['g0', 'kc', 'Karma Community', true, 'Root'],
      ['g1', 'org-1', 'Org One', false, 'Alice'],
    ]);
    expect(tree[1]).toMatchObject({ role: 'org_admin', scopeOrgId: 'org-1', managerGrantId: 'g0', lastSeenAt: null });
    expect(callsTo(calls, 'admin_role_grants')[0]?.filters).toContainEqual(['is', 'revoked_at', null]);
    expect(callsTo(calls, 'organizations')[0]?.filters).toEqual([['or', 'is_platform.eq.true,id.in.(org-1)']]);
  });

  it('narrows the tree to one organization', async () => {
    const { repo } = repoOf();
    expect((await repo.getOrgTree('org-1')).map((n) => n.grantId)).toEqual(['g1']);
    expect(await repo.getOrgTree('org-9')).toEqual([]);
  });

  it('reports a missing table', async () => {
    const { repo } = repoOf({ tables: { admin_role_grants: fail('PGRST205', 'nope') } });
    await expect(repo.getOrgTree(null)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseOrgHierarchyRepository — setManager', () => {
  it('moves a grant under another one and never detaches it', async () => {
    const { repo, calls } = repoOf();
    await repo.setManager('g1', 'g0');
    expect(callsTo(calls, 'admin_set_manager')[0]?.args).toEqual({ p_grant_id: 'g1', p_manager_grant_id: 'g0' });
    await expect(repo.setManager('g1', null)).rejects.toMatchObject({ code: 'invalid_manager' });
    expect(callsTo(calls, 'admin_set_manager')).toHaveLength(1);
  });

  it('maps the server reasons to hierarchy codes', async () => {
    const forbidden = repoOf({ rpc: { admin_set_manager: fail('P0001', 'forbidden_revoke') } });
    await expect(forbidden.repo.setManager('g1', 'g0')).rejects.toMatchObject({ code: 'forbidden_manage' });
    const invalid = repoOf({ rpc: { admin_set_manager: fail('P0001', 'invalid_manager') } });
    const error = await invalid.repo.setManager('g1', 'g0').catch((e: unknown) => e);
    expect(isOrgHierarchyError(error) && error.code).toBe('invalid_manager');
  });
});

describe('SupabaseOrgHierarchyRepository — getHierarchyCensus', () => {
  it('counts the role holders and lists the organizations, platform first', async () => {
    const { repo } = repoOf();
    const census = await repo.getHierarchyCensus();
    expect(census.roleHolderTotal).toBe(2);
    expect(census.orgs).toEqual([
      { orgId: 'kc', name: 'Karma Community', isPlatform: true, isVerified: false, affiliatedCount: 0 },
      { orgId: 'org-1', name: 'Org One', isPlatform: false, isVerified: true, affiliatedCount: 0 },
    ]);
  });
});
