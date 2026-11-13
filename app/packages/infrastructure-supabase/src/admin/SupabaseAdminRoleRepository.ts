import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAdminRoleRepository } from '@kc/application';
import {
  type AdminGrant,
  type AdminRole,
  AdminRoleError,
  type AdminRoleErrorCode,
  BackendUnavailableError,
  type GrantableAdminRole,
  parseAdminRole,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';
import { fetchMyAdminRoles } from './fetchMyAdminRoles';
import { refusalReason } from './refusalReason';

/** One row of `admin_list_admins` (migration 0012): a grant with names and last seen. */
type RosterRow = Database['public']['Functions']['admin_list_admins']['Returns'][number];

/** Stable refusals of the role RPCs (`60_moderation/020_admin_role_rpcs.sql`, migration 0011) the portal handles. */
const KNOWN_ERROR_REASONS: ReadonlySet<AdminRoleErrorCode> = new Set([
  'forbidden',
  'forbidden_grant',
  'forbidden_revoke',
  'invalid_role',
  'invalid_scope',
  'target_not_found',
  'target_not_active',
  'role_already_active',
  'grant_not_found',
  'grant_already_revoked',
  'org_last_admin',
]);

/**
 * Maps a failed call to `AdminRoleError` by the stable message the server refused with.
 * `BackendUnavailableError` passes through so the screen can degrade; `unauthenticated` is
 * a `forbidden` here (no session, no authority).
 */
function toAdminRoleError(error: unknown): unknown {
  if (error instanceof BackendUnavailableError) return error;
  const reason = refusalReason(error);
  if (reason === 'unauthenticated') return new AdminRoleError('forbidden', 'forbidden');
  if (reason !== null && KNOWN_ERROR_REASONS.has(reason as AdminRoleErrorCode)) {
    return new AdminRoleError(reason as AdminRoleErrorCode, reason);
  }
  const message = error instanceof Error ? error.message : '';
  return new AdminRoleError('unknown', reason ?? (message || 'unknown_admin_rpc_error'));
}

/** A roster row as a grant; null for a role this app does not know. */
export function mapRosterRow(row: RosterRow): AdminGrant | null {
  const role = parseAdminRole(row.role);
  if (role === null) return null;
  return {
    grantId: row.grant_id,
    userId: row.user_id,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    role,
    scopeOrgId: row.scope_org_id ?? null,
    grantedAt: new Date(row.granted_at),
    grantedBy: row.granted_by ?? null,
    grantedByDisplayName: row.granted_by_display_name ?? null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedBy: row.revoked_by ?? null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
  };
}

export class SupabaseAdminRoleRepository implements IAdminRoleRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Runs one call and maps every failure with {@link toAdminRoleError}. */
  private async call<T>(object: string, run: () => PromiseLike<CallResult<T>>): Promise<T> {
    try {
      return unwrapCall(object, await run());
    } catch (error) {
      throw toAdminRoleError(error);
    }
  }

  async getMyRoles(): Promise<readonly AdminRole[]> {
    return fetchMyAdminRoles(this.client);
  }

  /**
   * The roster the caller may read (`admin_list_admins`): every grant for platform admins,
   * the grants of the organizations the caller's grants reach for anyone else (FR-ADMIN-030
   * AC1), with the holder's and the granter's names and the holder's last-seen time.
   */
  async listAdmins(includeRevoked: boolean): Promise<readonly AdminGrant[]> {
    const rows = await this.call('rpc:admin_list_admins', () =>
      this.client.rpc('admin_list_admins', { p_include_revoked: includeRevoked }));
    return (rows ?? []).flatMap((row) => {
      const grant = mapRosterRow(row);
      return grant ? [grant] : [];
    });
  }

  async grantRole(
    targetUserId: string,
    role: GrantableAdminRole,
    scopeOrgId: string | null,
  ): Promise<string> {
    const data = await this.call('rpc:admin_grant_role', () =>
      this.client.rpc('admin_grant_role', {
        p_target_user_id: targetUserId,
        p_role: role,
        // Platform roles send no scope so the RPC's default (null) applies.
        ...(scopeOrgId === null ? {} : { p_scope_org_id: scopeOrgId }),
      }));
    if (typeof data !== 'string') {
      throw new AdminRoleError('unknown', 'admin_grant_role returned non-string grant_id');
    }
    return data;
  }

  async revokeRole(grantId: string): Promise<void> {
    await this.call('rpc:admin_revoke_role', () => this.client.rpc('admin_revoke_role', { p_grant_id: grantId }));
  }

  async changeRole(grantId: string, newRole: GrantableAdminRole): Promise<string> {
    const data = await this.call('rpc:admin_change_role', () =>
      this.client.rpc('admin_change_role', { p_grant_id: grantId, p_new_role: newRole }));
    if (typeof data !== 'string') {
      throw new AdminRoleError('unknown', 'admin_change_role returned non-string grant_id');
    }
    return data;
  }
}
