import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAdminRoleRepository } from '@kc/application';
import {
  type AdminGrant,
  type AdminRole,
  AdminRoleError,
  type AdminRoleErrorCode,
  type GrantableAdminRole,
  parseAdminRole,
} from '@kc/domain';
import { fetchMyAdminRoles } from './fetchMyAdminRoles';

interface AdminGrantRow {
  grant_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  scope_org_id: string | null;
  granted_at: string;
  granted_by: string | null;
  granted_by_display_name: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  last_seen_at: string | null;
}

const KNOWN_ERROR_MESSAGES: ReadonlySet<AdminRoleErrorCode> = new Set([
  'forbidden',
  'forbidden_grant',
  'forbidden_revoke',
  'invalid_input',
  'invalid_role',
  'invalid_scope',
  'target_not_found',
  'target_not_active',
  'role_already_active',
  'grant_not_found',
  'grant_already_revoked',
  'cannot_revoke_last_super_admin',
]);

function mapRpcError(err: { message?: string; code?: string } | null): AdminRoleError {
  const raw = err?.message ?? '';
  if ((KNOWN_ERROR_MESSAGES as Set<string>).has(raw)) {
    return new AdminRoleError(raw as AdminRoleErrorCode, raw);
  }
  if (err?.code === '42501') {
    return new AdminRoleError('forbidden', 'forbidden');
  }
  return new AdminRoleError('unknown', raw || 'unknown_admin_rpc_error');
}

function mapRowToGrant(row: AdminGrantRow): AdminGrant | null {
  const role = parseAdminRole(row.role);
  if (role === null) return null;
  return {
    grantId: row.grant_id,
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role,
    scopeOrgId: row.scope_org_id ?? null,
    grantedAt: new Date(row.granted_at),
    grantedBy: row.granted_by,
    grantedByDisplayName: row.granted_by_display_name,
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
    revokedBy: row.revoked_by,
    lastSeenAt: row.last_seen_at === null ? null : new Date(row.last_seen_at),
  };
}

export class SupabaseAdminRoleRepository implements IAdminRoleRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getMyRoles(): Promise<readonly AdminRole[]> {
    return fetchMyAdminRoles(this.client);
  }

  async listAdmins(includeRevoked: boolean): Promise<readonly AdminGrant[]> {
    const { data, error } = await this.client.rpc('admin_list_admins', {
      p_include_revoked: includeRevoked,
    });
    if (error) throw mapRpcError(error);
    if (!Array.isArray(data)) return [];
    const out: AdminGrant[] = [];
    for (const raw of data as AdminGrantRow[]) {
      const mapped = mapRowToGrant(raw);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }

  async grantRole(
    targetUserId: string,
    role: GrantableAdminRole,
    scopeOrgId: string | null,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('admin_grant_role', {
      p_target_user_id: targetUserId,
      p_role: role,
      // Platform roles send no scope so the RPC's default (null) applies.
      ...(scopeOrgId === null ? {} : { p_scope_org_id: scopeOrgId }),
    });
    if (error) throw mapRpcError(error);
    if (typeof data !== 'string') {
      throw new AdminRoleError('unknown', 'admin_grant_role returned non-string grant_id');
    }
    return data;
  }

  async revokeRole(grantId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_revoke_role', { p_grant_id: grantId });
    if (error) throw mapRpcError(error);
  }

  async changeRole(grantId: string, newRole: GrantableAdminRole): Promise<string> {
    const { data, error } = await this.client.rpc('admin_change_role', {
      p_grant_id: grantId,
      p_new_role: newRole,
    });
    if (error) throw mapRpcError(error);
    if (typeof data !== 'string') {
      throw new AdminRoleError('unknown', 'admin_change_role returned non-string grant_id');
    }
    return data;
  }
}
