import { describe, it, expect } from 'vitest';
import type { OrgTreeMember } from '../OrgTree';
import { buildOrgPeopleForest, groupPeopleByOrg } from '../OrgPeopleTree';

function grant(over: Partial<OrgTreeMember> & { grantId: string }): OrgTreeMember {
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

describe('buildOrgPeopleForest', () => {
  it('is empty for no grants', () => {
    expect(buildOrgPeopleForest([])).toEqual([]);
  });

  it('shows a user once per org, with every role they hold there', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'g1', userId: 'nave', displayName: 'Nave', role: 'support' }),
      grant({ grantId: 'g2', userId: 'nave', displayName: 'Nave', role: 'super_admin' }),
      grant({ grantId: 'g3', userId: 'nave', displayName: 'Nave', role: 'moderator' }),
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.person.roles).toEqual(['super_admin', 'moderator', 'support']);
  });

  it('keeps the same user as a separate person in each org', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'a', userId: 'u1', orgId: 'org-1', orgName: 'One' }),
      grant({ grantId: 'b', userId: 'u1', orgId: 'org-2', orgName: 'Two', scopeOrgId: 'org-2' }),
    ]);
    expect(forest.map((n) => n.person.orgId).sort()).toEqual(['org-1', 'org-2']);
  });

  it('nests people by manager and counts everyone below', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'root', role: 'org_admin' }),
      grant({ grantId: 'mgr', role: 'org_manager', managerGrantId: 'root' }),
      grant({ grantId: 'vol1', role: 'org_volunteer', managerGrantId: 'mgr' }),
      grant({ grantId: 'vol2', role: 'org_volunteer', managerGrantId: 'mgr' }),
    ]);
    expect(forest).toHaveLength(1);
    const root = forest[0]!;
    expect(root.level).toBe(0);
    expect(root.reportCount).toBe(3);
    expect(root.children[0]!.level).toBe(1);
    expect(root.children[0]!.children.map((c) => c.level)).toEqual([2, 2]);
  });

  it('places a multi-role person under the manager of any of their grants', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'boss', userId: 'boss', role: 'super_admin' }),
      grant({ grantId: 'm1', userId: 'nave', role: 'moderator' }),
      grant({ grantId: 'm2', userId: 'nave', role: 'org_admin', managerGrantId: 'boss' }),
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.children[0]!.person.userId).toBe('nave');
    expect(forest[0]!.children[0]!.person.roles).toEqual(['moderator', 'org_admin']);
  });

  it('treats a manager in another org as no manager', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'platform', userId: 'p', orgId: 'plat', orgName: 'KC', isPlatform: true, role: 'super_admin' }),
      grant({ grantId: 'child', userId: 'c', role: 'org_admin', managerGrantId: 'platform' }),
    ]);
    expect(forest).toHaveLength(2);
    expect(forest.every((n) => n.children.length === 0)).toBe(true);
  });

  it('does not lose people when grant edges form a cycle between two users', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'a1', userId: 'a', role: 'org_admin', managerGrantId: 'b2' }),
      grant({ grantId: 'b2', userId: 'b', role: 'org_manager', managerGrantId: 'a1' }),
    ]);
    const names: string[] = [];
    const walk = (nodes: typeof forest): void => nodes.forEach((n) => { names.push(n.person.userId); walk([...n.children]); });
    walk(forest);
    expect(names.sort()).toEqual(['a', 'b']);
  });

  it('ignores a manager grant that belongs to the same person', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'x1', userId: 'x', role: 'org_admin' }),
      grant({ grantId: 'x2', userId: 'x', role: 'org_manager', managerGrantId: 'x1' }),
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.children).toHaveLength(0);
  });
});

describe('groupPeopleByOrg', () => {
  it('puts the platform org first and counts members per org', () => {
    const forest = buildOrgPeopleForest([
      grant({ grantId: 'z', userId: 'z', orgId: 'org-z', orgName: 'Zeta', scopeOrgId: 'org-z' }),
      grant({ grantId: 'a', userId: 'a', orgId: 'org-a', orgName: 'Alpha', scopeOrgId: 'org-a' }),
      grant({ grantId: 'k', userId: 'k', orgId: 'plat', orgName: 'KC', isPlatform: true, role: 'super_admin' }),
      grant({ grantId: 'k2', userId: 'k2', orgId: 'plat', orgName: 'KC', isPlatform: true, role: 'moderator' }),
    ]);
    const sections = groupPeopleByOrg(forest);
    expect(sections.map((s) => s.orgName)).toEqual(['KC', 'Alpha', 'Zeta']);
    expect(sections[0]!.memberCount).toBe(2);
    expect(sections[1]!.memberCount).toBe(1);
  });
});
