import { describe, expect, it, vi } from 'vitest';
import type { HierarchyCensus, OrgTreeMember } from '@kc/domain';
import { GetHierarchySnapshotUseCase } from '../GetHierarchySnapshotUseCase';
import type { IOrgHierarchyRepository } from '../IOrgHierarchyRepository';

const CENSUS: HierarchyCensus = {
  communityTotal: 42,
  roleHolderTotal: 1,
  orgs: [{ orgId: 'p', name: 'Karma Community', isPlatform: true, isVerified: true, affiliatedCount: 0 }],
};

const MEMBER: OrgTreeMember = {
  grantId: 'g1',
  userId: 'u1',
  displayName: 'Root',
  avatarUrl: null,
  role: 'super_admin',
  scopeOrgId: null,
  orgId: 'p',
  orgName: 'Karma Community',
  isPlatform: true,
  managerGrantId: null,
  lastSeenAt: null,
};

const OTHER_ORG_MEMBER: OrgTreeMember = {
  ...MEMBER,
  grantId: 'g2',
  userId: 'u2',
  displayName: 'Org admin',
  role: 'org_admin',
  scopeOrgId: 'o1',
  orgId: 'o1',
  orgName: 'Alpha',
  isPlatform: false,
};

function repo(overrides: Partial<IOrgHierarchyRepository> = {}): IOrgHierarchyRepository {
  return {
    getOrgTree: vi.fn(async () => [MEMBER, OTHER_ORG_MEMBER]),
    setManager: vi.fn(),
    getHierarchyCensus: vi.fn(async () => CENSUS),
    ...overrides,
  };
}

describe('GetHierarchySnapshotUseCase', () => {
  it('returns members across every visible org together with the census', async () => {
    const r = repo();
    const snapshot = await new GetHierarchySnapshotUseCase(r).execute();
    expect(r.getOrgTree).toHaveBeenCalledWith(null);
    expect(snapshot).toEqual({ members: [MEMBER, OTHER_ORG_MEMBER], census: CENSUS });
  });

  it('propagates a census failure instead of returning a partial snapshot', async () => {
    const failure = new Error('forbidden');
    const r = repo({ getHierarchyCensus: vi.fn(async () => { throw failure; }) });
    await expect(new GetHierarchySnapshotUseCase(r).execute()).rejects.toBe(failure);
  });

  it('propagates a member-tree failure instead of returning an empty hierarchy', async () => {
    const failure = new Error('forbidden');
    const r = repo({ getOrgTree: vi.fn(async () => { throw failure; }) });
    await expect(new GetHierarchySnapshotUseCase(r).execute()).rejects.toBe(failure);
  });
});
