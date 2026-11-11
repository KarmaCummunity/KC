// FR-ADMIN-028 — the staff hierarchy (org tree, layered census) on the baseline grants.
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
type Tables = Database['public']['Tables'];
type GrantRow = Pick<Tables['admin_role_grants']['Row'], 'id' | 'user_id' | 'role' | 'scope_org_id' | 'manager_grant_id'>;
type OrgRow = Pick<Tables['organizations']['Row'], 'id' | 'name' | 'is_platform' | 'is_verified_nonprofit'>;
type MemberRow = Pick<Tables['users']['Row'], 'id' | 'display_name' | 'avatar_url'>;

const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set<OrgHierarchyErrorCode>([
  'forbidden', 'forbidden_manage', 'invalid_input', 'invalid_manager', 'grant_not_found', 'grant_already_revoked',
  'manager_not_found', 'manager_revoked', 'manager_other_org', 'manager_cycle', 'manager_rank',
]);
/** Reasons of the baseline admin_set_manager that the hierarchy vocabulary names differently. */
const RENAMED: Readonly<Record<string, OrgHierarchyErrorCode>> = { forbidden_revoke: 'forbidden_manage', unauthenticated: 'forbidden' };

function toHierarchyError(err: BackendErrorLike): OrgHierarchyError {
  const raw = err.message ?? '';
  if (KNOWN_ERROR_MESSAGES.has(raw)) return new OrgHierarchyError(raw as OrgHierarchyErrorCode, raw);
  const renamed = RENAMED[raw];
  if (renamed) return new OrgHierarchyError(renamed, raw);
  if (err.code === '42501') return new OrgHierarchyError('forbidden', 'forbidden');
  return new OrgHierarchyError('unknown', raw || 'unknown_org_hierarchy_error');
}

function unwrap<T>(object: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(object, result.error) ?? toHierarchyError(result.error);
}

/** The grants, members and organizations the caller may see, read once for a tree or a census. */
interface Snapshot {
  readonly grants: readonly GrantRow[];
  readonly orgs: readonly OrgRow[];
  /** The platform organization, the effective organization of every platform role. */
  readonly platformId: string | null;
}

/** The organization a grant belongs to: its scope, or the platform organization for a platform role. */
const effectiveOrgId = (grant: GrantRow, platformId: string | null) => grant.scope_org_id ?? platformId;

export function mapTreeMember(grant: GrantRow, member: MemberRow | null, org: OrgRow | null, platformId: string | null): OrgTreeMember | null {
  const role = parseAdminRole(grant.role);
  if (role === null) return null;
  return {
    grantId: grant.id,
    userId: grant.user_id,
    displayName: member?.display_name ?? null,
    avatarUrl: member?.avatar_url ?? null,
    role,
    scopeOrgId: grant.scope_org_id,
    orgId: effectiveOrgId(grant, platformId),
    orgName: org?.name ?? null,
    isPlatform: org?.is_platform === true,
    managerGrantId: grant.manager_grant_id,
    // Devices are private to their member; the baseline does not expose a last-seen time to staff.
    lastSeenAt: null,
  };
}

/**
 * Staff grants are a direct read of `admin_role_grants` (staff read every grant, an organization's
 * admins their organization's, a member their own), and the tree and the census are built on the
 * device (supabase/schemas/60_moderation/010, 80_organizations/060). A manager is changed with
 * `admin_set_manager`, which moves a grant under another one but never detaches it.
 */
export class SupabaseOrgHierarchyRepository implements IOrgHierarchyRepository {
  constructor(private readonly client: Client) {}

  async getOrgTree(orgId: string | null): Promise<readonly OrgTreeMember[]> {
    const { grants, orgs, platformId } = await this.snapshot();
    const shown = orgId === null ? grants : grants.filter((g) => effectiveOrgId(g, platformId) === orgId);
    if (shown.length === 0) return [];
    const members = unwrap(
      'table:users',
      await this.client.from('users').select('id, display_name, avatar_url').in('id', [...new Set(shown.map((g) => g.user_id))]),
    ) ?? [];
    const memberById = new Map(members.map((m) => [m.id, m]));
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    return shown.flatMap((grant) => {
      const org = orgById.get(effectiveOrgId(grant, platformId) ?? '') ?? null;
      const node = mapTreeMember(grant, memberById.get(grant.user_id) ?? null, org, platformId);
      return node ? [node] : [];
    });
  }

  async setManager(grantId: string, managerGrantId: string | null): Promise<void> {
    if (managerGrantId === null) throw new OrgHierarchyError('invalid_manager', 'a grant cannot be detached from its manager');
    unwrap(
      'rpc:admin_set_manager',
      await this.client.rpc('admin_set_manager', { p_grant_id: grantId, p_manager_grant_id: managerGrantId }),
    );
  }

  /** Members the caller can see, role holders, and the organizations of the visible grants (platform first). */
  async getHierarchyCensus(): Promise<HierarchyCensus> {
    const [{ grants, orgs, platformId }, community] = await Promise.all([
      this.snapshot(),
      this.client.from('users').select('id', { count: 'exact', head: true }),
    ]);
    unwrap('table:users', community);
    const used = new Set(grants.map((g) => effectiveOrgId(g, platformId)));
    const censusOrgs: HierarchyOrgCensus[] = orgs
      .filter((o) => used.has(o.id) || o.is_platform)
      .sort((a, b) => Number(b.is_platform) - Number(a.is_platform) || a.name.localeCompare(b.name))
      // The baseline has no self-declared affiliations, only grants.
      .map((o) => ({ orgId: o.id, name: o.name, isPlatform: o.is_platform, isVerified: o.is_verified_nonprofit, affiliatedCount: 0 }));
    return {
      communityTotal: community.count ?? 0,
      roleHolderTotal: new Set(grants.map((g) => g.user_id)).size,
      orgs: censusOrgs,
    };
  }

  private async snapshot(): Promise<Snapshot> {
    const grants = unwrap(
      'table:admin_role_grants',
      await this.client
        .from('admin_role_grants')
        .select('id, user_id, role, scope_org_id, manager_grant_id')
        .is('revoked_at', null)
        .order('granted_at', { ascending: true }),
    ) ?? [];
    const scoped = [...new Set(grants.flatMap((g) => (g.scope_org_id ? [g.scope_org_id] : [])))];
    const orgFilter = scoped.length > 0 ? `is_platform.eq.true,id.in.(${scoped.join(',')})` : 'is_platform.eq.true';
    const orgs = unwrap(
      'table:organizations',
      await this.client.from('organizations').select('id, name, is_platform, is_verified_nonprofit').or(orgFilter),
    ) ?? [];
    return { grants, orgs, platformId: orgs.find((o) => o.is_platform)?.id ?? null };
  }
}
