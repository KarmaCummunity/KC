// app/packages/domain/src/admin/GrantAuthority.ts
// FR-ADMIN-030 — who may grant, change, revoke or re-parent which grant.
//
// Mirrors the database's authority rules so the portal only offers actions the
// server will accept:
//   • can_grant_role  (migrations 0173 + 0442): the role matrix of FR-ADMIN-016
//     AND a role strictly junior to the viewer's most senior grant in scope;
//   • can_manage_grant (0442, FR-ADMIN-027): the viewer holds a grant that is an
//     ancestor of the target in the reporting tree and strictly more senior;
//   • admin_set_manager (0442): the new manager is the viewer or inside the
//     viewer's subtree, strictly senior to the target; only super_admin detaches.
// The server stays the authority and re-checks every call.
//
// Pure domain logic — no I/O, fully unit-tested.
import type { AdminRole } from './AdminRole';
import {
  fitsGrantScope,
  GRANTABLE_ADMIN_ROLES,
  isGrantableAdminRole,
  type GrantableAdminRole,
} from './AdminGrant';

/** A grant as an authority input: its role and the org it applies to. */
export interface AuthorityGrant {
  readonly role: AdminRole;
  readonly scopeOrgId: string | null;
}

/** A grant with its place in the reporting tree. */
export interface PositionedGrant extends AuthorityGrant {
  readonly grantId: string;
  readonly userId: string;
}

/** Everything the authority checks need to know about the viewer. */
export interface ViewerAuthority {
  readonly userId: string;
  /** The viewer's own active grants. */
  readonly grants: readonly PositionedGrant[];
  /** Direct manager of every visible grant (`manager_grant_id`). */
  readonly managerOf: ReadonlyMap<string, string | null>;
}

/** Seniority of each role, as `role_rank` (migration 0442). Higher = more senior. */
const ROLE_RANK: Readonly<Record<AdminRole, number>> = {
  super_admin:       100,
  org_admin:         80,
  org_manager:       70,
  moderator:         60,
  operators_manager: 60,
  volunteer_manager: 60,
  support:           50,
  org_employee:      40,
  operator:          40,
  org_volunteer:     30,
};

/** The org team below an org admin or org manager (FR-ADMIN-016 matrix). */
const ORG_TEAM_ROLES: readonly GrantableAdminRole[] = [
  'org_manager', 'operators_manager', 'volunteer_manager',
  'org_employee', 'org_volunteer', 'operator',
];

/**
 * Roles an org-scoped grant may hand out inside its own org. Exhaustive by
 * type, so a new role fails compilation until its authority is decided.
 */
const GRANTS_WITHIN_ORG: Readonly<Record<AdminRole, readonly GrantableAdminRole[]>> = {
  super_admin:       [],
  moderator:         [],
  support:           [],
  org_admin:         ORG_TEAM_ROLES,
  org_manager:       ORG_TEAM_ROLES,
  volunteer_manager: ['volunteer_manager', 'org_volunteer'],
  operators_manager: ['operator'],
  org_employee:      [],
  operator:          [],
  org_volunteer:     [],
};

export function roleRank(role: AdminRole): number {
  return ROLE_RANK[role];
}

function isPlatformSuperAdmin(grant: AuthorityGrant): boolean {
  return grant.role === 'super_admin' && grant.scopeOrgId === null;
}

/** The viewer's most senior rank that applies in `scopeOrgId` (`actor_scope_rank`). */
function scopeRank(viewer: readonly AuthorityGrant[], scopeOrgId: string | null): number {
  return viewer
    .filter((g) => g.scopeOrgId === scopeOrgId || isPlatformSuperAdmin(g))
    .reduce((top, g) => Math.max(top, ROLE_RANK[g.role]), 0);
}

/**
 * Whether the viewer may grant `role` in `scopeOrgId` (null = platform). The
 * scope must fit the role and super_admin is never grantable; the platform
 * super_admin may grant anything else anywhere; an org grant may grant only
 * its own team roles, inside its own org, strictly junior to the viewer.
 */
export function canGrantRole(
  viewer: readonly AuthorityGrant[],
  role: AdminRole,
  scopeOrgId: string | null,
): boolean {
  if (!isGrantableAdminRole(role) || !fitsGrantScope(role, scopeOrgId)) return false;
  if (viewer.some(isPlatformSuperAdmin)) return true;
  if (scopeOrgId === null || ROLE_RANK[role] >= scopeRank(viewer, scopeOrgId)) return false;
  return viewer.some((g) => g.scopeOrgId === scopeOrgId && GRANTS_WITHIN_ORG[g.role].includes(role));
}

/** Roles the viewer may grant in `scopeOrgId`, highest authority first. */
export function grantableRolesIn(
  viewer: readonly AuthorityGrant[],
  scopeOrgId: string | null,
): GrantableAdminRole[] {
  return GRANTABLE_ADMIN_ROLES.filter((role) => canGrantRole(viewer, role, scopeOrgId));
}

/** Whether `ancestorId` sits above `nodeId` in the reporting tree (`is_ancestor`). */
export function isAncestorGrant(
  ancestorId: string,
  nodeId: string,
  managerOf: ReadonlyMap<string, string | null>,
): boolean {
  const seen = new Set<string>([nodeId]);
  for (let id = managerOf.get(nodeId) ?? null; id !== null; id = managerOf.get(id) ?? null) {
    if (id === ancestorId) return true;
    if (seen.has(id)) return false; // a malformed cycle never loops
    seen.add(id);
  }
  return false;
}

/**
 * Whether the viewer manages `target` by position (`can_manage_grant`): the
 * platform super_admin always; anyone else through one of their own grants
 * that is an ancestor of the target and strictly more senior. Nobody manages
 * their own grants.
 */
export function canManageGrant(viewer: ViewerAuthority, target: PositionedGrant): boolean {
  if (viewer.grants.some(isPlatformSuperAdmin)) return true;
  if (target.userId === viewer.userId) return false;
  return viewer.grants.some((g) =>
    ROLE_RANK[g.role] > ROLE_RANK[target.role]
    && isAncestorGrant(g.grantId, target.grantId, viewer.managerOf));
}

/** Revoke authority (`admin_revoke_role`): manage the grant and grant its role there. */
export function canRevokeGrant(viewer: ViewerAuthority, target: PositionedGrant): boolean {
  return canManageGrant(viewer, target) && canGrantRole(viewer.grants, target.role, target.scopeOrgId);
}

/**
 * Roles an existing grant may change into (`admin_change_role`): every other
 * role the viewer may grant in the same scope, when the viewer may revoke the
 * grant itself. Empty otherwise.
 */
export function changeTargetsFor(viewer: ViewerAuthority, target: PositionedGrant): GrantableAdminRole[] {
  if (!canRevokeGrant(viewer, target)) return [];
  return grantableRolesIn(viewer.grants, target.scopeOrgId).filter((role) => role !== target.role);
}

/**
 * Direct managers the viewer may give `target` (`admin_set_manager`): grants in
 * the same org (or on the platform), not the target or one of its reports, and
 * — unless the viewer is super_admin — the viewer's own grant or one they
 * manage, strictly senior to the target. Empty when the viewer cannot manage
 * the target at all.
 */
export function managerCandidatesFor<G extends PositionedGrant>(
  viewer: ViewerAuthority,
  target: PositionedGrant,
  grants: readonly G[],
): G[] {
  if (!canManageGrant(viewer, target)) return [];
  const isSuper = viewer.grants.some(isPlatformSuperAdmin);
  return grants.filter((m) =>
    m.grantId !== target.grantId
    && (m.scopeOrgId === null || m.scopeOrgId === target.scopeOrgId)
    && (target.scopeOrgId !== null || m.scopeOrgId === null)
    && !isAncestorGrant(target.grantId, m.grantId, viewer.managerOf)
    && (isSuper || (
      ROLE_RANK[m.role] > ROLE_RANK[target.role]
      && (m.userId === viewer.userId || canManageGrant(viewer, m))
    )));
}

/** Only the platform super_admin may detach a grant to a tree root. */
export function canDetachManager(viewer: ViewerAuthority): boolean {
  return viewer.grants.some(isPlatformSuperAdmin);
}
