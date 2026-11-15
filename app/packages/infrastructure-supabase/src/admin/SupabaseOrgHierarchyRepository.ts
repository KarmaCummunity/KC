// FR-ADMIN-025 / FR-ADMIN-028 — the staff hierarchy (org tree, layered census, manager edge) and
// the super admin's change of an organization's page slug, over the RPCs of migrations 0011–0014.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrgHierarchyRepository } from '@kc/application';
import {
  type HierarchyCensus,
  type HierarchyOrgCensus,
  type OrgTreeMember,
  OrgHierarchyError,
  type OrgHierarchyErrorCode,
  parseAdminRole,
} from '@kc/domain';
import type { Database } from '../database.types';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;
/** One row of `admin_org_tree` (migration 0012). */
type TreeRow = Database['public']['Functions']['admin_org_tree']['Returns'][number];

/** Refusals of admin_set_manager, the tree and census reads and admin_set_org_slug. */
const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set<OrgHierarchyErrorCode>([
  'forbidden', 'forbidden_manage', 'invalid_input', 'invalid_manager', 'grant_not_found', 'grant_already_revoked',
  'manager_not_found', 'manager_revoked', 'manager_other_org', 'manager_cycle', 'manager_rank',
  'invalid_slug', 'slug_taken', 'org_not_found',
]);

function toHierarchyError(err: BackendErrorLike): OrgHierarchyError {
  const raw = err.message ?? '';
  if (KNOWN_ERROR_MESSAGES.has(raw)) return new OrgHierarchyError(raw as OrgHierarchyErrorCode, raw);
  // A signed-out caller and an opaque permission failure both mean "no authority".
  if (raw === 'unauthenticated' || err.code === '42501') return new OrgHierarchyError('forbidden', 'forbidden');
  return new OrgHierarchyError('unknown', raw || 'unknown_org_hierarchy_error');
}

function unwrap<T>(object: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(object, result.error) ?? toHierarchyError(result.error);
}

/** A tree row as a node; null for a role this app does not know. */
export function mapTreeMember(row: TreeRow): OrgTreeMember | null {
  const role = parseAdminRole(row.role);
  if (role === null) return null;
  return {
    grantId: row.grant_id,
    userId: row.user_id,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    role,
    scopeOrgId: row.scope_org_id ?? null,
    orgId: row.effective_org_id ?? null,
    orgName: row.org_name ?? null,
    isPlatform: row.is_platform === true,
    managerGrantId: row.manager_grant_id ?? null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
  };
}

/** Whether a JSON value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One organization of the census payload; null when its shape is not the expected one. */
function parseCensusOrg(value: unknown): HierarchyOrgCensus | null {
  if (!isRecord(value) || typeof value.org_id !== 'string' || typeof value.name !== 'string') return null;
  return {
    orgId: value.org_id,
    slug: typeof value.slug === 'string' ? value.slug : '',
    name: value.name,
    isPlatform: value.is_platform === true,
    isVerified: value.is_verified === true,
    affiliatedCount: typeof value.affiliated_count === 'number' ? value.affiliated_count : 0,
  };
}

/** The `admin_hierarchy_census` JSON object as the domain census (missing counts read as 0). */
export function parseHierarchyCensus(value: unknown): HierarchyCensus {
  const payload = isRecord(value) ? value : {};
  const orgs = Array.isArray(payload.orgs) ? payload.orgs : [];
  return {
    communityTotal: typeof payload.community_total === 'number' ? payload.community_total : 0,
    roleHolderTotal: typeof payload.role_holder_total === 'number' ? payload.role_holder_total : 0,
    orgs: orgs.flatMap((org) => {
      const parsed = parseCensusOrg(org);
      return parsed ? [parsed] : [];
    }),
  };
}

/**
 * The tree and the census come from `admin_org_tree` and `admin_hierarchy_census`, which scope
 * the rows to the organizations the caller's grants reach (everything for platform admins) and
 * carry the names and last-seen times the grant rows alone cannot. A manager is changed, or
 * (super admin only) cleared, with `admin_set_manager`.
 */
export class SupabaseOrgHierarchyRepository implements IOrgHierarchyRepository {
  constructor(private readonly client: Client) {}

  async getOrgTree(orgId: string | null): Promise<readonly OrgTreeMember[]> {
    const rows = unwrap(
      'rpc:admin_org_tree',
      await this.client.rpc('admin_org_tree', orgId === null ? {} : { p_org_id: orgId }),
    ) ?? [];
    return rows.flatMap((row) => {
      const node = mapTreeMember(row);
      return node ? [node] : [];
    });
  }

  async setManager(grantId: string, managerGrantId: string | null): Promise<void> {
    // No manager argument means "detach to the top of the tree" (super admin only, server-checked).
    unwrap(
      'rpc:admin_set_manager',
      await this.client.rpc('admin_set_manager', managerGrantId === null
        ? { p_grant_id: grantId }
        : { p_grant_id: grantId, p_manager_grant_id: managerGrantId }),
    );
  }

  async getHierarchyCensus(): Promise<HierarchyCensus> {
    return parseHierarchyCensus(unwrap('rpc:admin_hierarchy_census', await this.client.rpc('admin_hierarchy_census')));
  }

  async setOrgSlug(orgId: string, slug: string): Promise<string> {
    const stored = unwrap('rpc:admin_set_org_slug', await this.client.rpc('admin_set_org_slug', { p_org_id: orgId, p_slug: slug }));
    if (typeof stored !== 'string') throw new OrgHierarchyError('unknown', 'admin_set_org_slug returned no slug');
    return stored;
  }
}
