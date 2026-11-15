// FR-ADMIN-025 / FR-ADMIN-028 — the staff hierarchy over admin_org_tree, admin_hierarchy_census,
// admin_set_manager and admin_set_org_slug (migrations 0011–0014).
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, isOrgHierarchyError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { parseHierarchyCensus, SupabaseOrgHierarchyRepository } from '../SupabaseOrgHierarchyRepository';

const treeRow = (over: Record<string, unknown>) => ({
  grant_id: 'g0', user_id: 'u0', display_name: 'Root', avatar_url: null, role: 'super_admin',
  scope_org_id: null, effective_org_id: 'kc', org_name: 'Karma Community', is_platform: true,
  manager_grant_id: null, last_seen_at: '2026-03-02T10:00:00.000Z', ...over,
});
const TREE = [
  treeRow({}),
  treeRow({ grant_id: 'g1', user_id: 'u1', display_name: 'Alice', avatar_url: 'a.png', role: 'org_treasurer',
    scope_org_id: 'org-1', effective_org_id: 'org-1', org_name: 'Org One', is_platform: false,
    manager_grant_id: 'g0', last_seen_at: null }),
  treeRow({ grant_id: 'g2', role: 'mystery' }),
];
const CENSUS = {
  community_total: 40, role_holder_total: 6,
  orgs: [
    { org_id: 'kc', slug: 'kc', name: 'Karma Community', is_platform: true, is_verified: false, affiliated_count: 0 },
    { org_id: 'org-1', slug: 'one', name: 'Org One', is_platform: false, is_verified: true, affiliated_count: 3 },
    { name: 'no id' },
  ],
};

const repoOf = (config: FakeClientConfig = {}) => {
  const fake = createFakeClient({
    ...config,
    rpc: { admin_org_tree: ok(TREE), admin_hierarchy_census: ok(CENSUS), admin_set_manager: ok(null), ...config.rpc },
  });
  return { ...fake, repo: new SupabaseOrgHierarchyRepository(fake.client) };
};

describe('SupabaseOrgHierarchyRepository — getOrgTree', () => {
  it('maps the rows of admin_org_tree, last seen included, and drops unknown roles', async () => {
    const { repo, calls } = repoOf();
    const tree = await repo.getOrgTree(null);
    expect(tree.map((n) => [n.grantId, n.orgId, n.orgName, n.isPlatform, n.displayName])).toEqual([
      ['g0', 'kc', 'Karma Community', true, 'Root'],
      ['g1', 'org-1', 'Org One', false, 'Alice'],
    ]);
    expect(tree[0]?.lastSeenAt?.toISOString()).toBe('2026-03-02T10:00:00.000Z');
    expect(tree[1]).toMatchObject({ role: 'org_treasurer', scopeOrgId: 'org-1', managerGrantId: 'g0', lastSeenAt: null });
    expect(callsTo(calls, 'admin_org_tree')[0]?.args).toEqual({});
  });

  it('narrows the tree to one organization on the server', async () => {
    const { repo, calls } = repoOf();
    await repo.getOrgTree('org-1');
    expect(callsTo(calls, 'admin_org_tree')[0]?.args).toEqual({ p_org_id: 'org-1' });
  });

  it('reports a missing function and maps a refusal', async () => {
    await expect(repoOf({ rpc: { admin_org_tree: fail('PGRST202', 'nope') } }).repo.getOrgTree(null))
      .rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repoOf({ rpc: { admin_org_tree: fail('42501', 'forbidden') } }).repo.getOrgTree(null))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('SupabaseOrgHierarchyRepository — setManager', () => {
  it('moves a grant under another one, and detaches it by sending no manager', async () => {
    const { repo, calls } = repoOf();
    await repo.setManager('g1', 'g0');
    await repo.setManager('g1', null);
    expect(callsTo(calls, 'admin_set_manager').map((c) => c.args)).toEqual([
      { p_grant_id: 'g1', p_manager_grant_id: 'g0' },
      { p_grant_id: 'g1' },
    ]);
  });

  it.each(['forbidden_manage', 'manager_not_found', 'manager_revoked', 'manager_other_org', 'manager_cycle', 'manager_rank'])(
    'maps the server reason %s', async (reason) => {
      const { repo } = repoOf({ rpc: { admin_set_manager: fail('P0001', reason) } });
      const error = await repo.setManager('g1', 'g0').catch((e: unknown) => e);
      expect(isOrgHierarchyError(error) && error.code).toBe(reason);
    });
});

describe('SupabaseOrgHierarchyRepository — getHierarchyCensus', () => {
  it('reads the census of the server, slugs included, and skips a malformed organization', async () => {
    const { repo } = repoOf();
    const census = await repo.getHierarchyCensus();
    expect(census.communityTotal).toBe(40);
    expect(census.roleHolderTotal).toBe(6);
    expect(census.orgs).toEqual([
      { orgId: 'kc', slug: 'kc', name: 'Karma Community', isPlatform: true, isVerified: false, affiliatedCount: 0 },
      { orgId: 'org-1', slug: 'one', name: 'Org One', isPlatform: false, isVerified: true, affiliatedCount: 3 },
    ]);
  });

  it('reads a missing payload as an empty census', () => {
    expect(parseHierarchyCensus(null)).toEqual({ communityTotal: 0, roleHolderTotal: 0, orgs: [] });
  });
});

describe('SupabaseOrgHierarchyRepository — setOrgSlug', () => {
  it('returns the stored slug and maps the refusals', async () => {
    const { repo, calls } = repoOf({ rpc: { admin_set_org_slug: ok('aid-israel') } });
    expect(await repo.setOrgSlug('org-1', 'aid-israel')).toBe('aid-israel');
    expect(callsTo(calls, 'admin_set_org_slug')[0]?.args).toEqual({ p_org_id: 'org-1', p_slug: 'aid-israel' });
    for (const reason of ['slug_taken', 'invalid_slug', 'org_not_found']) {
      const refused = repoOf({ rpc: { admin_set_org_slug: fail('P0001', reason) } });
      await expect(refused.repo.setOrgSlug('org-1', 'x')).rejects.toMatchObject({ code: reason });
    }
    await expect(repoOf({ rpc: { admin_set_org_slug: ok(null) } }).repo.setOrgSlug('org-1', 'x'))
      .rejects.toMatchObject({ code: 'unknown' });
  });
});
