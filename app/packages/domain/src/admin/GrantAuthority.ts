// app/packages/domain/src/admin/GrantAuthority.ts
// FR-ADMIN-030 — who may grant, change, revoke or re-parent which grant.
//
// Mirrors the database's authority rules (60_moderation/020_admin_role_rpcs.sql and
// migration 0011) so the portal only offers actions the server will accept:
//   • admin_granting_grant: one of the viewer's grants lists the role as grantable, the
//     role is strictly junior to that grant, and the grant is a platform grant or sits in
//     the target organization;
//   • admin_can_manage_grant (FR-ADMIN-027): the super admin manages every grant but the
//     super admin grant, their own included; anyone else a grant of someone else below a
//     more senior grant of theirs;
//   • revoke and change also need the right to grant the grant's role in its scope;
//   • admin_set_manager: the new manager is the viewer or inside the viewer's subtree and
//     strictly senior to the target; only the super admin detaches or skips those rules.
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

/** Seniority of each role, as `kc_private.admin_roles.rank`. Higher = more senior. */
const ROLE_RANK: Readonly<Record<AdminRole, number>> = {
  super_admin:       100,
  admin:             90,
  org_admin:         80,
  org_manager:       70,
  moderator:         60,
  operators_manager: 60,
  volunteer_manager: 60,
  org_treasurer:     60,
  support:           50,
  org_employee:      40,
  operator:          40,
  org_accountant:    35,
  org_volunteer:     30,
  volunteer:         20,
};

/** The organization team below an org admin (FR-ADMIN-016 matrix, FR-FIN-002). */
const ORG_TEAM_ROLES: readonly GrantableAdminRole[] = [
  'org_manager', 'operators_manager', 'volunteer_manager', 'org_employee',
  'operator', 'org_volunteer', 'org_treasurer', 'org_accountant',
];

/**
 * Roles a grant of each role may hand out (`kc_private.admin_roles.grantable_roles`).
 * Exhaustive by type, so a new role fails compilation until its authority is decided.
 */
const GRANTABLE_BY: Readonly<Record<AdminRole, readonly GrantableAdminRole[]>> = {
  super_admin:       ['admin', 'moderator', 'support', 'org_admin', ...ORG_TEAM_ROLES],
  admin:             ['moderator', 'support', 'org_admin', ...ORG_TEAM_ROLES],
  org_admin:         ORG_TEAM_ROLES,
  org_manager:       ['operators_manager', 'volunteer_manager', 'org_employee', 'operator', 'org_volunteer'],
  moderator:         [],
  operators_manager: ['operator'],
  volunteer_manager: ['org_volunteer'],
  org_treasurer:     ['org_accountant'],
  support:           [],
  org_employee:      [],
  operator:          [],
  org_accountant:    [],
  org_volunteer:     [],
  volunteer:         [],
};

export function roleRank(role: AdminRole): number {
  return ROLE_RANK[role];
}

function isPlatformSuperAdmin(grant: AuthorityGrant): boolean {
  return grant.role === 'super_admin' && grant.scopeOrgId === null;
}

/** Whether one grant entitles its holder to hand out `role` in `scopeOrgId`. */
function grantAllows(grant: AuthorityGrant, role: GrantableAdminRole, scopeOrgId: string | null): boolean {
  return GRANTABLE_BY[grant.role].includes(role)
    && ROLE_RANK[role] < ROLE_RANK[grant.role]
    && (grant.scopeOrgId === null || grant.scopeOrgId === scopeOrgId);
}

/**
 * Whether the viewer may grant `role` in `scopeOrgId` (null = platform): the scope fits
 * the role and one of the viewer's grants allows it (`admin_granting_grant`).
 */
export function canGrantRole(
  viewer: readonly AuthorityGrant[],
  role: AdminRole,
  scopeOrgId: string | null,
): boolean {
  if (!isGrantableAdminRole(role) || !fitsGrantScope(role, scopeOrgId)) return false;
  return viewer.some((g) => grantAllows(g, role, scopeOrgId));
}

/** Roles the viewer may grant in `scopeOrgId`, highest authority first. */
export function grantableRolesIn(
  viewer: readonly AuthorityGrant[],
  scopeOrgId: string | null,
): GrantableAdminRole[] {
  return GRANTABLE_ADMIN_ROLES.filter((role) => canGrantRole(viewer, role, scopeOrgId));
}

/** Whether `ancestorId` sits above `nodeId` in the reporting tree (`admin_grant_is_above`). */
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
 * Whether the viewer manages `target` by position (`admin_can_manage_grant`): through a
 * grant of theirs that is strictly more senior and is either the platform super admin
 * grant (which reaches the viewer's own grants too) or an ancestor of a grant of someone
 * else. The super admin grant itself is never managed: nothing outranks it.
 */
export function canManageGrant(viewer: ViewerAuthority, target: PositionedGrant): boolean {
  return viewer.grants.some((g) =>
    ROLE_RANK[g.role] > ROLE_RANK[target.role]
    && (isPlatformSuperAdmin(g)
      || (target.userId !== viewer.userId && isAncestorGrant(g.grantId, target.grantId, viewer.managerOf))));
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
