// app/packages/domain/src/admin/OrgPeopleTree.ts
// FR-ADMIN-025 — the org hierarchy tree as people, not grants.
//
// `buildOrgForest` folds one node per grant. A person who holds several roles in
// one org (moderator + support + org_admin) would show up once per role, so the
// tree view uses this module instead: one node per (user, org), carrying every
// role the user holds there. Manager edges stay per grant in the database; a
// person reports to the owner of the manager grant of their most senior grant
// that has one, and only inside the same org. Pure domain logic, no I/O.
import type { AdminRole } from './AdminRole';
import { adminRoleRank } from './AdminPerson';
import type { OrgTreeMember } from './OrgTree';

export interface OrgPerson {
  /** Stable key: one person per org. */
  readonly key: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly orgId: string | null;
  readonly orgName: string | null;
  readonly isPlatform: boolean;
  /** Distinct roles held in this org, most senior first. */
  readonly roles: readonly AdminRole[];
  readonly lastSeenAt: Date | null;
}

export interface OrgPersonNode {
  readonly person: OrgPerson;
  /** Depth from a root (root = 0). */
  readonly level: number;
  readonly children: readonly OrgPersonNode[];
  /** Everyone below this person, at any depth. */
  readonly reportCount: number;
}

export interface OrgSection {
  readonly orgId: string | null;
  readonly orgName: string | null;
  readonly isPlatform: boolean;
  readonly roots: readonly OrgPersonNode[];
  readonly memberCount: number;
}

interface PersonDraft {
  readonly person: OrgPerson;
  readonly grants: readonly OrgTreeMember[];
}

const personKey = (m: OrgTreeMember): string => `${m.orgId ?? 'none'}:${m.userId}`;

function bestRank(person: OrgPerson): number {
  return Math.min(...person.roles.map(adminRoleRank));
}

function sortPeople(a: OrgPerson, b: OrgPerson): number {
  const rank = bestRank(a) - bestRank(b);
  if (rank !== 0) return rank;
  return (a.displayName ?? '').localeCompare(b.displayName ?? '');
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function draftPeople(members: readonly OrgTreeMember[]): Map<string, PersonDraft> {
  const grouped = new Map<string, OrgTreeMember[]>();
  for (const m of members) {
    const bucket = grouped.get(personKey(m));
    if (bucket) bucket.push(m);
    else grouped.set(personKey(m), [m]);
  }
  const out = new Map<string, PersonDraft>();
  for (const [key, grants] of grouped) {
    const bySeniority = [...grants].sort((a, b) => adminRoleRank(a.role) - adminRoleRank(b.role));
    const head = bySeniority[0]!;
    const roles = [...new Set(bySeniority.map((g) => g.role))];
    const person: OrgPerson = {
      key,
      userId: head.userId,
      displayName: head.displayName,
      avatarUrl: head.avatarUrl,
      orgId: head.orgId,
      orgName: head.orgName,
      isPlatform: head.isPlatform,
      roles,
      lastSeenAt: grants.reduce<Date | null>((acc, g) => latest(acc, g.lastSeenAt), null),
    };
    out.set(key, { person, grants: bySeniority });
  }
  return out;
}

/** The person each person reports to: via their most senior grant that has a manager in the same org. */
function managerKeys(
  drafts: ReadonlyMap<string, PersonDraft>,
  ownerOfGrant: ReadonlyMap<string, string>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [key, draft] of drafts) {
    let manager: string | null = null;
    for (const g of draft.grants) {
      const owner = g.managerGrantId === null ? undefined : ownerOfGrant.get(g.managerGrantId);
      if (owner !== undefined && owner !== key && drafts.get(owner)?.person.orgId === draft.person.orgId) {
        manager = owner;
        break;
      }
    }
    out.set(key, manager);
  }
  return out;
}

/** Break a report cycle (grant edges can chain A -> B -> A across different roles) so nobody vanishes. */
function breakCycles(managers: Map<string, string | null>): void {
  for (const start of managers.keys()) {
    const seen = new Set<string>([start]);
    let cur = managers.get(start) ?? null;
    while (cur !== null) {
      if (seen.has(cur)) {
        managers.set(start, null);
        break;
      }
      seen.add(cur);
      cur = managers.get(cur) ?? null;
    }
  }
}

function buildNode(
  person: OrgPerson,
  level: number,
  reportsOf: ReadonlyMap<string, OrgPerson[]>,
): OrgPersonNode {
  const children = (reportsOf.get(person.key) ?? [])
    .sort(sortPeople)
    .map((p) => buildNode(p, level + 1, reportsOf));
  const reportCount = children.reduce((n, c) => n + 1 + c.reportCount, 0);
  return { person, level, children, reportCount };
}

/** Fold the flat per-grant adjacency list into a forest with one node per person per org. */
export function buildOrgPeopleForest(members: readonly OrgTreeMember[]): OrgPersonNode[] {
  const drafts = draftPeople(members);
  const ownerOfGrant = new Map(members.map((m) => [m.grantId, personKey(m)] as const));
  const managers = managerKeys(drafts, ownerOfGrant);
  breakCycles(managers);

  const reportsOf = new Map<string, OrgPerson[]>();
  const roots: OrgPerson[] = [];
  for (const [key, draft] of drafts) {
    const manager = managers.get(key) ?? null;
    if (manager === null) {
      roots.push(draft.person);
      continue;
    }
    const bucket = reportsOf.get(manager);
    if (bucket) bucket.push(draft.person);
    else reportsOf.set(manager, [draft.person]);
  }
  return roots.sort(sortPeople).map((p) => buildNode(p, 0, reportsOf));
}

function countNodes(nodes: readonly OrgPersonNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

/** Group the roots by org: the platform org first, then the rest by name. */
export function groupPeopleByOrg(forest: readonly OrgPersonNode[]): OrgSection[] {
  const sections = new Map<string, { head: OrgPerson; roots: OrgPersonNode[] }>();
  for (const root of forest) {
    const id = root.person.orgId ?? 'none';
    const section = sections.get(id);
    if (section) section.roots.push(root);
    else sections.set(id, { head: root.person, roots: [root] });
  }
  return [...sections.values()]
    .map(({ head, roots }) => ({
      orgId: head.orgId,
      orgName: head.orgName,
      isPlatform: head.isPlatform,
      roots,
      memberCount: countNodes(roots),
    }))
    .sort((a, b) => {
      if (a.isPlatform !== b.isPlatform) return a.isPlatform ? -1 : 1;
      return (a.orgName ?? '').localeCompare(b.orgName ?? '');
    });
}
