import { describe, it, expect } from 'vitest';
import {
  buildHierarchyPyramid,
  roleBaseLevel,
  type HierarchyCensus,
  type HierarchyPyramid,
} from '../HierarchyPyramid';
import type { OrgTreeMember } from '../OrgTree';

const PLATFORM = 'org-platform';

function member(over: Partial<OrgTreeMember> & { grantId: string }): OrgTreeMember {
  return {
    userId: `u-${over.grantId}`,
    displayName: over.grantId,
    avatarUrl: null,
    role: 'org_volunteer',
    scopeOrgId: 'org-a',
    orgId: 'org-a',
    orgName: 'Alpha',
    isPlatform: false,
    managerGrantId: null,
    lastSeenAt: null,
    ...over,
  };
}

function platformMember(over: Partial<OrgTreeMember> & { grantId: string }): OrgTreeMember {
  return member({ scopeOrgId: null, orgId: PLATFORM, orgName: 'Karma Community', isPlatform: true, ...over });
}

const CENSUS: HierarchyCensus = {
  communityTotal: 100,
  roleHolderTotal: 6,
  orgs: [
    { orgId: PLATFORM, name: 'Karma Community', isPlatform: true, isVerified: true, affiliatedCount: 0 },
    { orgId: 'org-a', name: 'Alpha', isPlatform: false, isVerified: true, affiliatedCount: 4 },
    { orgId: 'org-b', name: 'Beta', isPlatform: false, isVerified: false, affiliatedCount: 1 },
  ],
};

function build(members: readonly OrgTreeMember[], focus: string | null = null): HierarchyPyramid {
  return buildHierarchyPyramid({ members, census: CENSUS }, focus);
}

/** Level → display names, for compact assertions. */
function namesByLevel(pyramid: HierarchyPyramid): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const layer of pyramid.layers) {
    out[layer.level] = layer.groups.flatMap((g) => g.people.map((p) => p.displayName ?? ''));
  }
  return out;
}

describe('roleBaseLevel', () => {
  it('places unlinked grants at their role’s natural level', () => {
    expect(roleBaseLevel('super_admin', true)).toBe(0);
    expect(roleBaseLevel('moderator', true)).toBe(1);
    expect(roleBaseLevel('org_admin', false)).toBe(1);
    expect(roleBaseLevel('org_manager', false)).toBe(2);
    expect(roleBaseLevel('volunteer_manager', false)).toBe(3);
    expect(roleBaseLevel('org_volunteer', false)).toBe(4);
  });

  it('places operations roles by scope', () => {
    expect(roleBaseLevel('operators_manager', true)).toBe(1);
    expect(roleBaseLevel('operator', true)).toBe(2);
    expect(roleBaseLevel('operators_manager', false)).toBe(3);
    expect(roleBaseLevel('operator', false)).toBe(4);
  });
});

describe('buildHierarchyPyramid — levels', () => {
  it('returns no layers and the community base when nobody holds a role', () => {
    const pyramid = build([]);
    expect(pyramid.layers).toEqual([]);
    expect(pyramid.visiblePeople).toBe(0);
    expect(pyramid.base).toEqual({ maskedCount: 94, affiliatedCount: 5, communityTotal: 100 });
  });

  it('floors the masked count at zero', () => {
    const pyramid = buildHierarchyPyramid({
      members: [],
      census: { ...CENSUS, communityTotal: 2, roleHolderTotal: 5 },
    });
    expect(pyramid.base.maskedCount).toBe(0);
  });

  it('adds one level per link, with no depth limit', () => {
    // super_admin → org_admin → manager → manager → manager → manager → volunteer manager → volunteer
    const pyramid = build([
      platformMember({ grantId: 'root', role: 'super_admin' }),
      member({ grantId: 'admin', role: 'org_admin', managerGrantId: 'root' }),
      member({ grantId: 'm1', role: 'org_manager', managerGrantId: 'admin' }),
      member({ grantId: 'm2', role: 'org_manager', managerGrantId: 'm1' }),
      member({ grantId: 'm3', role: 'org_manager', managerGrantId: 'm2' }),
      member({ grantId: 'm4', role: 'org_manager', managerGrantId: 'm3' }),
      member({ grantId: 'vm', role: 'volunteer_manager', managerGrantId: 'm4' }),
      member({ grantId: 'vol', role: 'org_volunteer', managerGrantId: 'vm' }),
    ]);
    expect(pyramid.layers.map((l) => l.level)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(namesByLevel(pyramid)[7]).toEqual(['vol']);
  });

  it('places a report one level below its manager, whatever its role', () => {
    const pyramid = build([
      member({ grantId: 'admin', role: 'org_admin' }),
      member({ grantId: 'vol', role: 'org_volunteer', managerGrantId: 'admin' }),
    ]);
    expect(namesByLevel(pyramid)).toEqual({ 1: ['admin'], 2: ['vol'] });
  });

  it('falls back to the natural level when the manager is not visible', () => {
    const pyramid = build([member({ grantId: 'vm', role: 'volunteer_manager', managerGrantId: 'out-of-scope' })]);
    expect(namesByLevel(pyramid)).toEqual({ 3: ['vm'] });
  });

  it('keeps grants on a manager cycle, at their natural level', () => {
    const pyramid = build([
      member({ grantId: 'a', role: 'org_manager', managerGrantId: 'b' }),
      member({ grantId: 'b', role: 'volunteer_manager', managerGrantId: 'a' }),
    ]);
    expect(namesByLevel(pyramid)).toEqual({ 2: ['a'], 3: ['b'] });
    expect(pyramid.visiblePeople).toBe(2);
  });

  it('lists the roles present at each level, highest first', () => {
    const pyramid = build([
      member({ grantId: 'emp', role: 'org_employee' }),
      member({ grantId: 'vm', role: 'volunteer_manager' }),
    ]);
    expect(pyramid.layers[0]?.roles).toEqual(['volunteer_manager', 'org_employee']);
  });
});

describe('buildHierarchyPyramid — grouping', () => {
  it('groups people by org inside a level, platform org first', () => {
    const pyramid = build([
      member({ grantId: 'b1', role: 'org_admin', orgId: 'org-b', scopeOrgId: 'org-b', orgName: 'Beta' }),
      member({ grantId: 'a1', role: 'org_admin' }),
      platformMember({ grantId: 'p1', role: 'moderator' }),
    ]);
    expect(pyramid.layers[0]?.groups.map((g) => g.orgName)).toEqual(['Karma Community', 'Alpha', 'Beta']);
  });

  it('merges a person’s grants at the same level and org into one entry', () => {
    const pyramid = build([
      platformMember({ grantId: 's1', userId: 'u-x', role: 'support' }),
      platformMember({ grantId: 'm1', userId: 'u-x', role: 'moderator' }),
    ]);
    expect(pyramid.layers[0]?.headcount).toBe(1);
    expect(pyramid.layers[0]?.groups[0]?.people[0]?.roles).toEqual(['moderator', 'support']);
    expect(pyramid.visiblePeople).toBe(1);
  });

  it('shows a person at each level their grants occupy', () => {
    const pyramid = build([
      member({ grantId: 'g1', userId: 'u-y', role: 'org_admin' }),
      member({ grantId: 'g2', userId: 'u-y', role: 'org_volunteer' }),
    ]);
    expect(pyramid.layers.map((l) => [l.level, l.headcount])).toEqual([[1, 1], [4, 1]]);
    expect(pyramid.visiblePeople).toBe(1);
  });

  it('sorts people by role rank, then by name', () => {
    const pyramid = build([
      member({ grantId: 'zed', role: 'org_employee' }),
      member({ grantId: 'amy', role: 'org_employee' }),
      member({ grantId: 'vm', role: 'volunteer_manager' }),
    ]);
    expect(namesByLevel(pyramid)[3]).toEqual(['vm', 'amy', 'zed']);
  });
});

describe('buildHierarchyPyramid — focus', () => {
  const snapshotMembers = [
    platformMember({ grantId: 'mod', role: 'moderator' }),
    member({ grantId: 'admin', role: 'org_admin', managerGrantId: 'mod' }),
    member({ grantId: 'bob', role: 'org_admin', orgId: 'org-b', scopeOrgId: 'org-b', orgName: 'Beta' }),
  ];

  it('keeps levels computed on the whole snapshot', () => {
    // `admin` reports to a platform moderator, so it stays at level 2 under focus.
    expect(namesByLevel(build(snapshotMembers))).toEqual({ 1: ['mod', 'bob'], 2: ['admin'] });
    expect(namesByLevel(build(snapshotMembers, 'org-a'))).toEqual({ 2: ['admin'] });
  });

  it('narrows affiliates to the focused org but keeps the community base', () => {
    const focused = build(snapshotMembers, 'org-a');
    expect(focused.base).toEqual({ maskedCount: 94, affiliatedCount: 4, communityTotal: 100 });
    expect(focused.visiblePeople).toBe(1);
    // The org summary always describes every visible org, regardless of focus.
    expect(focused.orgs.map((o) => [o.orgId, o.memberCount])).toEqual([
      [PLATFORM, 1], ['org-a', 1], ['org-b', 1],
    ]);
  });

  // `admin_org_tree` resolves platform grants to the platform org, so an
  // unresolved org only occurs if no platform org row exists. Such members
  // stay visible in the unfocused view but belong to no census org.
  it('keeps platform members without a resolved org in their own bucket', () => {
    const members = [platformMember({ grantId: 'p1', role: 'moderator', orgId: null, orgName: null })];
    const pyramid = build(members);
    const group = pyramid.layers[0]?.groups[0];
    expect(group?.orgId).toBe('platform');
    expect(group?.isPlatform).toBe(true);
    expect(pyramid.visiblePeople).toBe(1);
    expect(pyramid.orgs.every((o) => o.memberCount === 0)).toBe(true);
    expect(build(members, PLATFORM).layers).toEqual([]);
  });
});
