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

interface OrgTreeRow {
  grant_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  scope_org_id: string | null;
  effective_org_id: string | null;
  org_name: string | null;
  is_platform: boolean | null;
  manager_grant_id: string | null;
  last_seen_at: string | null;
}

const KNOWN_ERROR_MESSAGES: ReadonlySet<OrgHierarchyErrorCode> = new Set([
  'forbidden',
  'forbidden_manage',
  'invalid_input',
  'invalid_manager',
  'grant_not_found',
  'grant_already_revoked',
  'manager_not_found',
  'manager_revoked',
  'manager_other_org',
  'manager_cycle',
  'manager_rank',
]);

function mapRpcError(err: { message?: string; code?: string } | null): OrgHierarchyError {
  const raw = err?.message ?? '';
  if ((KNOWN_ERROR_MESSAGES as Set<string>).has(raw)) {
    return new OrgHierarchyError(raw as OrgHierarchyErrorCode, raw);
  }
  if (err?.code === '42501') {
    return new OrgHierarchyError('forbidden', 'forbidden');
  }
  return new OrgHierarchyError('unknown', raw || 'unknown_org_hierarchy_rpc_error');
}

/** Shape of one `orgs[]` entry in the `admin_hierarchy_census` JSON payload. */
interface CensusOrgJson {
  org_id?: unknown;
  name?: unknown;
  is_platform?: unknown;
  is_verified?: unknown;
  affiliated_count?: unknown;
}

/** Non-negative integer from an untyped JSON value (0 for anything else). */
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function mapCensusOrg(raw: CensusOrgJson): HierarchyOrgCensus | null {
  if (typeof raw.org_id !== 'string') return null;
  return {
    orgId: raw.org_id,
    name: typeof raw.name === 'string' ? raw.name : '',
    isPlatform: raw.is_platform === true,
    isVerified: raw.is_verified === true,
    affiliatedCount: toCount(raw.affiliated_count),
  };
}

/** Parse the census JSON defensively: malformed org entries are dropped and
 *  missing counts read as zero, so a partial payload never crashes the view. */
function mapCensus(data: unknown): HierarchyCensus {
  const obj = (data ?? {}) as { community_total?: unknown; role_holder_total?: unknown; orgs?: unknown };
  const orgs: HierarchyOrgCensus[] = [];
  if (Array.isArray(obj.orgs)) {
    for (const raw of obj.orgs as CensusOrgJson[]) {
      const mapped = mapCensusOrg(raw ?? {});
      if (mapped !== null) orgs.push(mapped);
    }
  }
  return {
    communityTotal: toCount(obj.community_total),
    roleHolderTotal: toCount(obj.role_holder_total),
    orgs,
  };
}

function mapRow(row: OrgTreeRow): OrgTreeMember | null {
  const role = parseAdminRole(row.role);
  if (role === null) return null;
  return {
    grantId: row.grant_id,
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role,
    scopeOrgId: row.scope_org_id,
    orgId: row.effective_org_id,
    orgName: row.org_name,
    isPlatform: row.is_platform === true,
    managerGrantId: row.manager_grant_id,
    lastSeenAt: row.last_seen_at === null ? null : new Date(row.last_seen_at),
  };
}

export class SupabaseOrgHierarchyRepository implements IOrgHierarchyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getOrgTree(orgId: string | null): Promise<readonly OrgTreeMember[]> {
    const { data, error } = await this.client.rpc('admin_org_tree', {
      p_org_id: orgId,
    });
    if (error) throw mapRpcError(error);
    if (!Array.isArray(data)) return [];
    const out: OrgTreeMember[] = [];
    for (const raw of data as OrgTreeRow[]) {
      const mapped = mapRow(raw);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }

  async setManager(grantId: string, managerGrantId: string | null): Promise<void> {
    const { error } = await this.client.rpc('admin_set_manager', {
      p_grant_id: grantId,
      p_manager_grant_id: managerGrantId,
    });
    if (error) throw mapRpcError(error);
  }

  async getHierarchyCensus(): Promise<HierarchyCensus> {
    const { data, error } = await this.client.rpc('admin_hierarchy_census');
    if (error) throw mapRpcError(error);
    return mapCensus(data);
  }
}
