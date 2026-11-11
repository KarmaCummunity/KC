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

type GrantRow = Database['public']['Tables']['admin_role_grants']['Row'];

/** Display fields of a member, read from `users` to label a grant. */
interface PersonLabel {
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

/** Stable refusals of the role RPCs (`60_moderation/020_admin_role_rpcs.sql`) the portal handles. */
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

function mapRowToGrant(
  row: GrantRow,
  people: ReadonlyMap<string, PersonLabel>,
): AdminGrant | null {
  const role = parseAdminRole(row.role);
  if (role === null) return null;
  const member = people.get(row.user_id);
  return {
    grantId: row.id,
    userId: row.user_id,
    displayName: member?.displayName ?? null,
    avatarUrl: member?.avatarUrl ?? null,
    role,
    scopeOrgId: row.scope_org_id ?? null,
    grantedAt: new Date(row.granted_at),
    grantedBy: row.granted_by,
    grantedByDisplayName: row.granted_by ? people.get(row.granted_by)?.displayName ?? null : null,
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
    revokedBy: row.revoked_by,
    // `users.last_seen_at` does not exist in the baseline: presence is not shown.
    lastSeenAt: null,
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

  async listAdmins(includeRevoked: boolean): Promise<readonly AdminGrant[]> {
    // `admin_role_grants_select_staff`: platform staff read the whole roster; any other member
    // reads only their own grants (the baseline has no org-scoped roster read).
    const grants = await this.call('table:admin_role_grants', () => {
      const query = this.client
        .from('admin_role_grants')
        .select('id, user_id, role, scope_org_id, is_platform, manager_grant_id, granted_by, granted_at, revoked_at, revoked_by')
        .order('granted_at', { ascending: false });
      return includeRevoked ? query : query.is('revoked_at', null);
    });
    const rows = grants ?? [];
    const people = await this.loadPeople(rows);
    const out: AdminGrant[] = [];
    for (const row of rows) {
      const mapped = mapRowToGrant(row, people);
      if (mapped !== null) out.push(mapped);
    }
    return out;
  }

  /** Display name and avatar of every member a grant names (holder and granter). */
  private async loadPeople(rows: readonly GrantRow[]): Promise<Map<string, PersonLabel>> {
    const ids = [...new Set(rows.flatMap((r) => (r.granted_by ? [r.user_id, r.granted_by] : [r.user_id])))];
    if (ids.length === 0) return new Map();
    const users = await this.call('table:users', () =>
      this.client.from('users').select('id, display_name, avatar_url').in('id', ids));
    return new Map((users ?? []).map((u) => [u.id, { displayName: u.display_name, avatarUrl: u.avatar_url }]));
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
