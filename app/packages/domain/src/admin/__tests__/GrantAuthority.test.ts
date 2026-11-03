import { describe, expect, it } from 'vitest';
import {
  canDetachManager,
  canGrantRole,
  canManageGrant,
  canRevokeGrant,
  changeTargetsFor,
  grantableRolesIn,
  isAncestorGrant,
  managerCandidatesFor,
  type AuthorityGrant,
  type PositionedGrant,
  type ViewerAuthority,
} from '../GrantAuthority';

const SUPER: AuthorityGrant = { role: 'super_admin', scopeOrgId: null };
const MODERATOR: AuthorityGrant = { role: 'moderator', scopeOrgId: null };
const ADMIN_A: AuthorityGrant = { role: 'org_admin', scopeOrgId: 'org-a' };
const MANAGER_A: AuthorityGrant = { role: 'org_manager', scopeOrgId: 'org-a' };
const VOL_MANAGER_A: AuthorityGrant = { role: 'volunteer_manager', scopeOrgId: 'org-a' };
const OPS_MANAGER_A: AuthorityGrant = { role: 'operators_manager', scopeOrgId: 'org-a' };

function grant(grantId: string, userId: string, base: AuthorityGrant): PositionedGrant {
  return { grantId, userId, ...base };
}

// Org A: admin (g-admin) ← manager (g-mgr) ← volunteer manager (g-vm) ← volunteer (g-vol);
// g-side is an org_employee with no manager (outside everyone's subtree).
const TREE = new Map<string, string | null>([
  ['g-admin', null], ['g-mgr', 'g-admin'], ['g-vm', 'g-mgr'], ['g-vol', 'g-vm'], ['g-side', null],
]);
const G_ADMIN = grant('g-admin', 'u-admin', ADMIN_A);
const G_MGR = grant('g-mgr', 'u-mgr', MANAGER_A);
const G_VM = grant('g-vm', 'u-vm', VOL_MANAGER_A);
const G_VOL = grant('g-vol', 'u-vol', { role: 'org_volunteer', scopeOrgId: 'org-a' });
const G_SIDE = grant('g-side', 'u-side', { role: 'org_employee', scopeOrgId: 'org-a' });
const ALL = [G_ADMIN, G_MGR, G_VM, G_VOL, G_SIDE];

function viewer(userId: string, grants: PositionedGrant[]): ViewerAuthority {
  return { userId, grants, managerOf: TREE };
}

const AS_SUPER = viewer('u-super', [grant('g-super', 'u-super', SUPER)]);
const AS_MGR = viewer('u-mgr', [G_MGR]);
const AS_VM = viewer('u-vm', [G_VM]);

describe('canGrantRole', () => {
  it('lets the platform super_admin grant every role but super_admin, in a fitting scope', () => {
    expect(canGrantRole([SUPER], 'moderator', null)).toBe(true);
    expect(canGrantRole([SUPER], 'org_admin', 'org-a')).toBe(true);
    expect(canGrantRole([SUPER], 'super_admin', null)).toBe(false);
    expect(canGrantRole([SUPER], 'moderator', 'org-a')).toBe(false);
    expect(canGrantRole([SUPER], 'org_manager', null)).toBe(false);
  });

  it('keeps an org admin inside their own org team', () => {
    expect(canGrantRole([ADMIN_A], 'org_manager', 'org-a')).toBe(true);
    expect(canGrantRole([ADMIN_A], 'org_admin', 'org-a')).toBe(false);
    expect(canGrantRole([ADMIN_A], 'org_manager', 'org-b')).toBe(false);
    expect(canGrantRole([ADMIN_A], 'moderator', null)).toBe(false);
  });

  it('grants only roles strictly junior to the viewer (FR-ADMIN-027)', () => {
    // org_manager's matrix includes org_manager, but an equal rank is refused.
    expect(canGrantRole([MANAGER_A], 'org_manager', 'org-a')).toBe(false);
    expect(canGrantRole([MANAGER_A], 'volunteer_manager', 'org-a')).toBe(true);
    // volunteer_manager may grant volunteers but not another volunteer manager.
    expect(canGrantRole([VOL_MANAGER_A], 'volunteer_manager', 'org-a')).toBe(false);
    expect(canGrantRole([VOL_MANAGER_A], 'org_volunteer', 'org-a')).toBe(true);
    expect(canGrantRole([OPS_MANAGER_A], 'operator', 'org-a')).toBe(true);
  });

  it('gives platform staff without super_admin no grant authority', () => {
    expect(canGrantRole([MODERATOR], 'support', null)).toBe(false);
    expect(canGrantRole([], 'org_volunteer', 'org-a')).toBe(false);
  });
});

describe('grantableRolesIn', () => {
  it('lists the roles a viewer may grant in an org, highest first', () => {
    expect(grantableRolesIn([VOL_MANAGER_A], 'org-a')).toEqual(['org_volunteer']);
    expect(grantableRolesIn([MANAGER_A], 'org-a'))
      .toEqual(['operators_manager', 'volunteer_manager', 'org_employee', 'operator', 'org_volunteer']);
    expect(grantableRolesIn([MANAGER_A], 'org-b')).toEqual([]);
  });

  it('lists only platform roles on the platform', () => {
    expect(grantableRolesIn([SUPER], null)).toEqual(['moderator', 'support']);
  });
});

describe('position in the tree', () => {
  it('walks the manager chain upward and survives a cycle', () => {
    expect(isAncestorGrant('g-admin', 'g-vol', TREE)).toBe(true);
    expect(isAncestorGrant('g-vol', 'g-admin', TREE)).toBe(false);
    const cycle = new Map([['a', 'b'], ['b', 'a']]);
    expect(isAncestorGrant('c', 'a', cycle)).toBe(false);
  });

  it('manages only grants below the viewer that are strictly junior', () => {
    expect(canManageGrant(AS_MGR, G_VOL)).toBe(true);
    expect(canManageGrant(AS_MGR, G_SIDE)).toBe(false); // not in the subtree
    expect(canManageGrant(AS_MGR, G_ADMIN)).toBe(false); // above the viewer
    expect(canManageGrant(AS_MGR, G_MGR)).toBe(false);   // own grant
    expect(canManageGrant(AS_SUPER, G_SIDE)).toBe(true);
  });

  it('revokes and re-roles only with position and grant authority', () => {
    expect(canRevokeGrant(AS_MGR, G_VM)).toBe(true);
    expect(canRevokeGrant(AS_VM, G_VOL)).toBe(true);
    expect(changeTargetsFor(AS_VM, G_VOL)).toEqual([]); // nothing else below a volunteer manager
    expect(changeTargetsFor(AS_MGR, G_VOL))
      .toEqual(['operators_manager', 'volunteer_manager', 'org_employee', 'operator']);
    expect(changeTargetsFor(AS_MGR, G_SIDE)).toEqual([]);
  });

  it('offers managers in the viewer\'s subtree that are senior to the target', () => {
    const ids = (gs: PositionedGrant[]) => gs.map((g) => g.grantId);
    // The org manager may move the volunteer under themself or the volunteer manager.
    expect(ids(managerCandidatesFor(AS_MGR, G_VOL, ALL))).toEqual(['g-mgr', 'g-vm']);
    // Never under one of the target's own reports (a cycle).
    expect(ids(managerCandidatesFor(AS_SUPER, G_MGR, ALL))).toEqual(['g-admin', 'g-side']);
    expect(managerCandidatesFor(AS_VM, G_SIDE, ALL)).toEqual([]);
  });

  it('lets only super_admin detach a grant to a root', () => {
    expect(canDetachManager(AS_SUPER)).toBe(true);
    expect(canDetachManager(AS_MGR)).toBe(false);
  });
});
