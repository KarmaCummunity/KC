// app/packages/domain/src/admin/AdminPerson.ts
// FR-ADMIN-022 — unified per-user view of admin grants.
//
// The admins list RPC returns one row per grant, so a user holding several
// roles appears multiple times. The UI shows one card per *user* with all
// their roles, so this module folds the flat grant list into `AdminPerson`s.
// Pure domain logic — no I/O, fully unit-tested.
import type { AdminGrant } from './AdminGrant';
import type { AdminRole } from './AdminRole';

/** Display order of roles: lower index = shown first. Platform staff come first, then the
 *  operations roles, then each organization's team from its administrator down. */
export const ADMIN_ROLE_ORDER: readonly AdminRole[] = [
  'super_admin', 'admin', 'moderator', 'support',
  'operators_manager', 'operator',
  'org_admin', 'org_manager', 'org_treasurer', 'volunteer_manager', 'org_employee', 'org_accountant',
  'org_volunteer', 'volunteer',
];

export function adminRoleRank(role: AdminRole): number {
  const i = ADMIN_ROLE_ORDER.indexOf(role);
  return i === -1 ? ADMIN_ROLE_ORDER.length : i;
}

export interface AdminPerson {
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  /** Distinct roles the user currently holds (active grants), highest first. */
  readonly activeRoles: readonly AdminRole[];
  /** Every grant for this user (active + revoked), active first then newest. */
  readonly grants: readonly AdminGrant[];
  readonly lastSeenAt: Date | null;
  readonly hasActiveGrant: boolean;
  /** Top active role for sectioning/sorting; null when fully revoked. */
  readonly highestActiveRole: AdminRole | null;
}

function sortGrants(grants: readonly AdminGrant[]): AdminGrant[] {
  return [...grants].sort((a, b) => {
    const aActive = a.revokedAt === null ? 0 : 1;
    const bActive = b.revokedAt === null ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const rank = adminRoleRank(a.role) - adminRoleRank(b.role);
    if (rank !== 0) return rank;
    return b.grantedAt.getTime() - a.grantedAt.getTime();
  });
}

function distinctActiveRoles(grants: readonly AdminGrant[]): AdminRole[] {
  const seen = new Set<AdminRole>();
  for (const g of grants) if (g.revokedAt === null) seen.add(g.role);
  return [...seen].sort((a, b) => adminRoleRank(a) - adminRoleRank(b));
}

function latestSeen(grants: readonly AdminGrant[]): Date | null {
  let max: Date | null = null;
  for (const g of grants) {
    if (g.lastSeenAt !== null && (max === null || g.lastSeenAt > max)) max = g.lastSeenAt;
  }
  return max;
}

function toPerson(userId: string, grants: readonly AdminGrant[]): AdminPerson {
  const sorted = sortGrants(grants);
  const activeRoles = distinctActiveRoles(sorted);
  const head = sorted[0];
  return {
    userId,
    displayName: head?.displayName ?? null,
    avatarUrl: head?.avatarUrl ?? null,
    activeRoles,
    grants: sorted,
    lastSeenAt: latestSeen(sorted),
    hasActiveGrant: activeRoles.length > 0,
    highestActiveRole: activeRoles[0] ?? null,
  };
}

/** Stable sort key: active-first, then by highest role, then most-recently
 *  seen, then name. Folded into a tuple so the comparator stays trivial. */
function personSortKey(p: AdminPerson): readonly [number, number, number, string] {
  const activeRank = p.hasActiveGrant ? 0 : 1;
  const roleRank = p.highestActiveRole === null ? Infinity : adminRoleRank(p.highestActiveRole);
  const seen = -(p.lastSeenAt?.getTime() ?? -1);
  return [activeRank, roleRank, seen, p.displayName ?? ''];
}

function comparePeople(a: AdminPerson, b: AdminPerson): number {
  const ka = personSortKey(a);
  const kb = personSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  if (ka[2] !== kb[2]) return ka[2] - kb[2];
  return ka[3].localeCompare(kb[3]);
}

/** Fold a flat grant list into one `AdminPerson` per user, ordered for display
 *  (active people first by highest role, then fully-revoked people last). */
export function groupGrantsByUser(grants: readonly AdminGrant[]): AdminPerson[] {
  const byUser = new Map<string, AdminGrant[]>();
  for (const g of grants) {
    const bucket = byUser.get(g.userId);
    if (bucket) bucket.push(g);
    else byUser.set(g.userId, [g]);
  }
  const people: AdminPerson[] = [];
  for (const [userId, list] of byUser) people.push(toPerson(userId, list));
  return people.sort(comparePeople);
}
