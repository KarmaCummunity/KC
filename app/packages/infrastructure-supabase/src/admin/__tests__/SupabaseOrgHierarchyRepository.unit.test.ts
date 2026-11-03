import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isOrgHierarchyError, OrgHierarchyError } from '@kc/domain';
import { SupabaseOrgHierarchyRepository } from '../SupabaseOrgHierarchyRepository';

function mockClient(rpcImpl: (name: string, args?: unknown) => unknown): SupabaseClient {
  return { rpc: vi.fn(rpcImpl as never) } as unknown as SupabaseClient;
}

const ROW = {
  grant_id: 'g1',
  user_id: 'u1',
  display_name: 'Alice',
  avatar_url: null,
  role: 'org_admin',
  scope_org_id: 'org-1',
  effective_org_id: 'org-1',
  org_name: 'Org One',
  is_platform: false,
  manager_grant_id: null,
  last_seen_at: '2026-01-02T00:00:00.000Z',
};

describe('SupabaseOrgHierarchyRepository — getOrgTree', () => {
  it('maps rows to OrgTreeMember + parses last_seen_at', async () => {
    const repo = new SupabaseOrgHierarchyRepository(mockClient(() => ({ data: [ROW], error: null })));
    const out = await repo.getOrgTree(null);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      grantId: 'g1',
      userId: 'u1',
      role: 'org_admin',
      orgId: 'org-1',
      orgName: 'Org One',
      isPlatform: false,
      managerGrantId: null,
    });
    expect(out[0]?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('passes p_org_id through to the RPC', async () => {
    const rpc = vi.fn(() => ({ data: [], error: null }));
    const repo = new SupabaseOrgHierarchyRepository({ rpc } as unknown as SupabaseClient);
    await repo.getOrgTree('org-9');
    expect(rpc).toHaveBeenCalledWith('admin_org_tree', { p_org_id: 'org-9' });
  });

  it('drops rows with an unparseable role', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: [{ ...ROW, role: 'not_a_role' }], error: null })),
    );
    expect(await repo.getOrgTree(null)).toEqual([]);
  });

  it('returns empty array on null data', async () => {
    const repo = new SupabaseOrgHierarchyRepository(mockClient(() => ({ data: null, error: null })));
    expect(await repo.getOrgTree(null)).toEqual([]);
  });

  it('maps forbidden by SQLSTATE when message is opaque', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: null, error: { message: 'permission denied', code: '42501' } })),
    );
    await expect(repo.getOrgTree(null)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('SupabaseOrgHierarchyRepository — setManager', () => {
  it('resolves to void on success', async () => {
    const repo = new SupabaseOrgHierarchyRepository(mockClient(() => ({ data: null, error: null })));
    await expect(repo.setManager('g1', 'm1')).resolves.toBeUndefined();
  });

  it('passes both params to the RPC (null clears)', async () => {
    const rpc = vi.fn(() => ({ data: null, error: null }));
    const repo = new SupabaseOrgHierarchyRepository({ rpc } as unknown as SupabaseClient);
    await repo.setManager('g1', null);
    expect(rpc).toHaveBeenCalledWith('admin_set_manager', { p_grant_id: 'g1', p_manager_grant_id: null });
  });

  it('maps manager_cycle by message', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: null, error: { message: 'manager_cycle', code: 'P0001' } })),
    );
    const err = await repo.setManager('g1', 'm1').catch((e) => e);
    expect(isOrgHierarchyError(err)).toBe(true);
    expect((err as OrgHierarchyError).code).toBe('manager_cycle');
  });

  it('maps manager_rank by message (FR-ADMIN-027 rank rule)', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: null, error: { message: 'manager_rank', code: '22023' } })),
    );
    const err = await repo.setManager('g1', 'm1').catch((e) => e);
    expect((err as OrgHierarchyError).code).toBe('manager_rank');
  });

  it('maps manager_other_org by message', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: null, error: { message: 'manager_other_org', code: '22023' } })),
    );
    await expect(repo.setManager('g1', 'm1')).rejects.toMatchObject({ code: 'manager_other_org' });
  });

  it('falls back to unknown on unrecognized error', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: null, error: { message: 'weird', code: '99999' } })),
    );
    await expect(repo.setManager('g1', 'm1')).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('SupabaseOrgHierarchyRepository — getHierarchyCensus', () => {
  it('maps the census payload and calls the RPC without args', async () => {
    const rpc = vi.fn(() => ({
      data: {
        community_total: 120,
        role_holder_total: 7,
        orgs: [
          { org_id: 'p', name: 'Karma Community', is_platform: true, is_verified: true, affiliated_count: 0 },
          { org_id: 'o1', name: 'Alpha', is_platform: false, is_verified: false, affiliated_count: 3 },
        ],
      },
      error: null,
    }));
    const repo = new SupabaseOrgHierarchyRepository({ rpc } as unknown as SupabaseClient);
    const census = await repo.getHierarchyCensus();
    expect(rpc).toHaveBeenCalledWith('admin_hierarchy_census');
    expect(census).toEqual({
      communityTotal: 120,
      roleHolderTotal: 7,
      orgs: [
        { orgId: 'p', name: 'Karma Community', isPlatform: true, isVerified: true, affiliatedCount: 0 },
        { orgId: 'o1', name: 'Alpha', isPlatform: false, isVerified: false, affiliatedCount: 3 },
      ],
    });
  });

  it('tolerates a malformed payload: drops bad orgs and zeroes bad counts', async () => {
    const repo = new SupabaseOrgHierarchyRepository(mockClient(() => ({
      data: { community_total: -4, role_holder_total: 'x', orgs: [{ name: 'no id' }, null] },
      error: null,
    })));
    expect(await repo.getHierarchyCensus()).toEqual({ communityTotal: 0, roleHolderTotal: 0, orgs: [] });
  });

  it('maps a 42501 rejection to forbidden', async () => {
    const repo = new SupabaseOrgHierarchyRepository(
      mockClient(() => ({ data: null, error: { message: 'forbidden', code: '42501' } })),
    );
    await expect(repo.getHierarchyCensus()).rejects.toMatchObject({ code: 'forbidden' });
  });
});
