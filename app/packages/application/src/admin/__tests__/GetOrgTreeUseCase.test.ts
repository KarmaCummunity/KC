import { describe, expect, it, vi } from 'vitest';
import type { OrgTreeMember } from '@kc/domain';
import { GetOrgTreeUseCase } from '../GetOrgTreeUseCase';
import type { IOrgHierarchyRepository } from '../IOrgHierarchyRepository';

function member(over: Partial<OrgTreeMember> & { grantId: string }): OrgTreeMember {
  return {
    userId: `u-${over.grantId}`,
    displayName: over.grantId,
    avatarUrl: null,
    role: 'org_volunteer',
    scopeOrgId: 'org-1',
    orgId: 'org-1',
    orgName: 'Org One',
    isPlatform: false,
    managerGrantId: null,
    lastSeenAt: null,
    ...over,
  };
}

function repo(members: readonly OrgTreeMember[]): IOrgHierarchyRepository {
  return {
    getOrgTree: vi.fn(async () => members),
    setManager: vi.fn(),
    getHierarchyCensus: vi.fn(),
  };
}

describe('GetOrgTreeUseCase', () => {
  it('folds the repository adjacency list into a forest', async () => {
    const uc = new GetOrgTreeUseCase(repo([
      member({ grantId: 'root', role: 'super_admin' }),
      member({ grantId: 'child', role: 'org_admin', managerGrantId: 'root' }),
    ]));
    const forest = await uc.execute({ orgId: null });
    expect(forest).toHaveLength(1);
    expect(forest[0]!.member.grantId).toBe('root');
    expect(forest[0]!.children[0]!.member.grantId).toBe('child');
    expect(forest[0]!.children[0]!.level).toBe(1);
  });

  it('forwards the orgId filter to the repository', async () => {
    const r = repo([]);
    const uc = new GetOrgTreeUseCase(r);
    await uc.execute({ orgId: 'org-7' });
    expect(r.getOrgTree).toHaveBeenCalledWith('org-7');
  });

  it('returns an empty forest when there are no members', async () => {
    const uc = new GetOrgTreeUseCase(repo([]));
    expect(await uc.execute({ orgId: null })).toEqual([]);
  });
});
