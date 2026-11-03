// app/packages/domain/src/admin/HierarchyPyramid.ts
// FR-ADMIN-028 — layered hierarchy across every organisation (D83, D84).
//
// Folds two inputs into a stack of levels, top (authority) to bottom (reach):
//   • the RBAC-filtered role-holders from `admin_org_tree` (named people), and
//   • the aggregate census from `admin_hierarchy_census` (counts only).
//
// Levels follow the reporting chain, so their number is not fixed: a grant
// sits one level below its visible manager, however long the chain. A grant
// without a visible manager sits at its role's natural level. Every level is a
// list of org groups; a person with several grants at the same level in the
// same org appears once with all of those roles. Under the levels lies the
// masked community base: it carries counts, never identities.
//
// Pure domain logic — no I/O, fully unit-tested.
import type { AdminRole } from './AdminRole';
import { adminRoleRank } from './AdminPerson';
import { buildOrgForest, type OrgTreeMember, type OrgTreeNode } from './OrgTree';

/** Per-org aggregate row from `admin_hierarchy_census`. */
export interface HierarchyOrgCensus {
  readonly orgId: string;
  readonly name: string;
  readonly isPlatform: boolean;
  readonly isVerified: boolean;
  /** Self-declared volunteer affiliations without a grant in this org. */
  readonly affiliatedCount: number;
}

export interface HierarchyCensus {
  /** Every community member (active or suspended, D84). */
  readonly communityTotal: number;
  /** Distinct members holding at least one active grant (platform-wide). */
  readonly roleHolderTotal: number;
  /** Orgs visible to the caller, platform org first. */
  readonly orgs: readonly HierarchyOrgCensus[];
}

/**
 * Raw inputs of the hierarchy. They come from two read-only RPCs issued in
 * parallel, not one transaction, so a grant committed in between can skew the
 * masked count by one for a single refresh; `maskedCount` is floored at 0.
 */
export interface HierarchySnapshot {
  readonly members: readonly OrgTreeMember[];
  readonly census: HierarchyCensus;
}

export interface LayerPerson {
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  /** Roles this person holds at this level in this org, highest first. */
  readonly roles: readonly AdminRole[];
  readonly lastSeenAt: Date | null;
}

export interface LayerOrgGroup {
  readonly orgId: string;
  readonly orgName: string;
  readonly isPlatform: boolean;
  readonly people: readonly LayerPerson[];
}

export interface HierarchyLayer {
  /** Depth in the management chain (0 = platform apex). */
  readonly level: number;
  /** Number of person entries across all groups at this level. */
  readonly headcount: number;
  /** Distinct roles present at this level, highest first. */
  readonly roles: readonly AdminRole[];
  readonly groups: readonly LayerOrgGroup[];
}

export interface HierarchyOrgSummary extends HierarchyOrgCensus {
  /** Distinct named role-holders of this org. */
  readonly memberCount: number;
}

export interface CommunityBase {
  /** Members with no grant anywhere — shown masked, count only. */
  readonly maskedCount: number;
  /** Self-declared volunteers in the focused orgs (aggregate, unnamed). */
  readonly affiliatedCount: number;
  readonly communityTotal: number;
}

export interface HierarchyPyramid {
  /** Non-empty levels only, top to bottom. Depth is not bounded. */
  readonly layers: readonly HierarchyLayer[];
  readonly base: CommunityBase;
  /** Every visible org with its counts — drives the focus filter. */
  readonly orgs: readonly HierarchyOrgSummary[];
  /** Distinct named people across the (possibly focused) levels. */
  readonly visiblePeople: number;
}

/**
 * Natural level of a grant that has no visible manager, for org-scoped (or
 * scope-independent) roles. Exhaustive by type, so adding a role to
 * `AdminRole` fails compilation until it is placed.
 */
const ROLE_BASE_LEVEL: Readonly<Record<AdminRole, number>> = {
  super_admin:       0,
  moderator:         1,
  support:           1,
  org_admin:         1,
  org_manager:       2,
  operators_manager: 3,
  volunteer_manager: 3,
  org_employee:      3,
  operator:          4,
  org_volunteer:     4,
};

/** Operations roles sit higher when they serve the platform rather than an org. */
const PLATFORM_OPERATIONS_LEVEL: Partial<Readonly<Record<AdminRole, number>>> = {
  operators_manager: 1,
  operator:          2,
};

/** Level of a grant that does not report to a visible manager. */
export function roleBaseLevel(role: AdminRole, isPlatform: boolean): number {
  const platformLevel = isPlatform ? PLATFORM_OPERATIONS_LEVEL[role] : undefined;
  return platformLevel ?? ROLE_BASE_LEVEL[role];
}

/** Effective org of a member; platform roles without a resolved org share one bucket. */
const PLATFORM_FALLBACK_ORG = 'platform';

function orgKeyOf(member: OrgTreeMember): string {
  return member.orgId ?? PLATFORM_FALLBACK_ORG;
}

interface LeveledMember {
  readonly member: OrgTreeMember;
  readonly level: number;
}

/**
 * Assign every grant its level: roots take their role's natural level, each
 * report sits one level below its manager. Built on `buildOrgForest`, which
 * already resolves visible managers and guards against cycles.
 */
function levelMembers(members: readonly OrgTreeMember[]): LeveledMember[] {
  const out: LeveledMember[] = [];
  const placed = new Set<string>();
  const walk = (node: OrgTreeNode, level: number): void => {
    out.push({ member: node.member, level });
    placed.add(node.member.grantId);
    for (const child of node.children) walk(child, level + 1);
  };
  for (const root of buildOrgForest(members)) {
    walk(root, roleBaseLevel(root.member.role, root.member.isPlatform));
  }
  // A manager cycle has no root, so the forest never reaches it. The RPC
  // rejects cycles, but concurrent writes could still persist one; such grants
  // fall back to their role's natural level rather than vanishing from view.
  for (const m of members) {
    if (!placed.has(m.grantId)) out.push({ member: m, level: roleBaseLevel(m.role, m.isPlatform) });
  }
  return out;
}

/** Mutable accumulator for one (level, org) group while folding. */
interface GroupDraft {
  readonly orgId: string;
  readonly orgName: string;
  readonly isPlatform: boolean;
  readonly people: Map<string, { member: OrgTreeMember; roles: AdminRole[] }>;
}

function byRank(a: AdminRole, b: AdminRole): number {
  return adminRoleRank(a) - adminRoleRank(b);
}

function compareGroups(a: LayerOrgGroup, b: LayerOrgGroup): number {
  if (a.isPlatform !== b.isPlatform) return a.isPlatform ? -1 : 1;
  return a.orgName.localeCompare(b.orgName);
}

/** Rank of a person's highest role (roles are sorted, never empty). */
function topRank(person: LayerPerson): number {
  const top = person.roles[0];
  return top === undefined ? Number.MAX_SAFE_INTEGER : adminRoleRank(top);
}

function comparePeople(a: LayerPerson, b: LayerPerson): number {
  const rank = topRank(a) - topRank(b);
  if (rank !== 0) return rank;
  return (a.displayName ?? '').localeCompare(b.displayName ?? '');
}

function finalizeGroup(draft: GroupDraft): LayerOrgGroup {
  const people = [...draft.people.values()]
    .map(({ member, roles }) => ({
      userId: member.userId,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      roles: [...roles].sort(byRank),
      lastSeenAt: member.lastSeenAt,
    }))
    .sort(comparePeople);
  return { orgId: draft.orgId, orgName: draft.orgName, isPlatform: draft.isPlatform, people };
}

/** Bucket leveled grants into `level → org → person`, merging a person's roles. */
function bucketByLevel(leveled: readonly LeveledMember[]): Map<number, Map<string, GroupDraft>> {
  const levels = new Map<number, Map<string, GroupDraft>>();
  for (const { member: m, level } of leveled) {
    const orgKey = orgKeyOf(m);
    const groups = levels.get(level) ?? new Map<string, GroupDraft>();
    levels.set(level, groups);
    const group = groups.get(orgKey) ?? {
      orgId: orgKey,
      orgName: m.orgName ?? '',
      isPlatform: m.isPlatform,
      people: new Map(),
    };
    groups.set(orgKey, group);
    const entry = group.people.get(m.userId);
    if (entry) {
      if (!entry.roles.includes(m.role)) entry.roles.push(m.role);
    } else {
      group.people.set(m.userId, { member: m, roles: [m.role] });
    }
  }
  return levels;
}

function buildLayers(leveled: readonly LeveledMember[]): HierarchyLayer[] {
  return [...bucketByLevel(leveled)]
    .sort(([a], [b]) => a - b)
    .map(([level, drafts]) => {
      const groups = [...drafts.values()].map(finalizeGroup).sort(compareGroups);
      const headcount = groups.reduce((sum, g) => sum + g.people.length, 0);
      const roles = [...new Set(groups.flatMap((g) => g.people.flatMap((p) => p.roles)))].sort(byRank);
      return { level, headcount, roles, groups };
    });
}

function summarizeOrgs(
  census: HierarchyCensus,
  members: readonly OrgTreeMember[],
): HierarchyOrgSummary[] {
  const usersByOrg = new Map<string, Set<string>>();
  for (const m of members) {
    const key = orgKeyOf(m);
    const set = usersByOrg.get(key) ?? new Set<string>();
    set.add(m.userId);
    usersByOrg.set(key, set);
  }
  return census.orgs.map((org) => ({
    ...org,
    memberCount: usersByOrg.get(org.orgId)?.size ?? 0,
  }));
}

/**
 * Build the layered hierarchy. Levels are computed over every visible grant
 * first, then `focusOrgId` narrows the named levels and the affiliated count
 * to one org — so focusing never re-levels anyone. The masked base always
 * describes the whole community: it is the platform's shared audience.
 */
export function buildHierarchyPyramid(
  snapshot: HierarchySnapshot,
  focusOrgId: string | null = null,
): HierarchyPyramid {
  const { census } = snapshot;
  const leveled = levelMembers(snapshot.members);
  const focused = focusOrgId === null
    ? leveled
    : leveled.filter((l) => orgKeyOf(l.member) === focusOrgId);
  const focusedOrgs = focusOrgId === null
    ? census.orgs
    : census.orgs.filter((o) => o.orgId === focusOrgId);

  return {
    layers: buildLayers(focused),
    base: {
      maskedCount: Math.max(0, census.communityTotal - census.roleHolderTotal),
      affiliatedCount: focusedOrgs.reduce((sum, o) => sum + o.affiliatedCount, 0),
      communityTotal: census.communityTotal,
    },
    orgs: summarizeOrgs(census, snapshot.members),
    visiblePeople: new Set(focused.map((l) => l.member.userId)).size,
  };
}
