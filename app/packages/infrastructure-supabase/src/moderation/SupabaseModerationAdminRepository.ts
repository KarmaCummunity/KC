import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IModerationAdminRepository,
  ModerationTargetType,
  BanReason,
} from '@kc/application';
import {
  ModerationError,
  ModerationForbiddenError,
  InvalidRestoreStateError,
} from '@kc/application';
import { BackendUnavailableError, type AdminRole, type AuditEvent } from '@kc/domain';
import { fetchMyAdminRoles } from '../admin/fetchMyAdminRoles';
import { callAuditSearch } from '../admin/auditSearchCall';
import { refusalReason } from '../admin/refusalReason';
import type { Database } from '../database.types';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';

/** The refusals of the moderation RPCs that map one-to-one onto a `ModerationError` code. */
const PLAIN_REASONS: ReadonlySet<ModerationError['code']> = new Set([
  'invalid_target_state',
  'report_not_open',
  'invalid_sanction_reason',
  'cannot_sanction_self',
  'cannot_sanction_admin',
  'account_pending_deletion',
  'target_not_found',
  'message_not_found',
]);

/**
 * Maps a failed staff call to the moderation errors by the stable message the RPC refused
 * with (never by SQLSTATE or text). A missing backend object stays a `BackendUnavailableError`
 * so the screen can degrade.
 */
function toModerationError(error: unknown): unknown {
  if (error instanceof BackendUnavailableError) return error;
  const reason = refusalReason(error);
  const cause = error instanceof Error ? error : undefined;
  if (reason === null) return new ModerationError('unknown', cause?.message, error);
  if (reason === 'forbidden' || reason === 'unauthenticated') return new ModerationForbiddenError(error);
  if (reason === 'invalid_restore_state') return new InvalidRestoreStateError(error);
  if (PLAIN_REASONS.has(reason as ModerationError['code'])) {
    return new ModerationError(reason as ModerationError['code'], reason, error);
  }
  return new ModerationError('unknown', reason, error);
}

/**
 * FR-MOD-010 / FR-ADMIN-002..007 — Supabase adapter for the staff moderation actions.
 * Calls the `60_moderation` RPCs (and `admin_delete_message` of the messaging module) and
 * maps their stable `P0001` messages to typed errors.
 */
export class SupabaseModerationAdminRepository implements IModerationAdminRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Runs one call and maps every failure with {@link toModerationError}. */
  private async call<T>(object: string, run: () => PromiseLike<CallResult<T>>): Promise<T> {
    try {
      return unwrapCall(object, await run());
    } catch (error) {
      throw toModerationError(error);
    }
  }

  async isPlatformStaff(userId: string): Promise<boolean> {
    // `admin_role_grants_select_staff`: only staff read other members' grants, and the only
    // caller is a super admin about to ban. `is_platform` = the grant has no organization.
    const rows = await this.call('table:admin_role_grants', () =>
      this.client
        .from('admin_role_grants')
        .select('id')
        .eq('user_id', userId)
        .eq('is_platform', true)
        .is('revoked_at', null)
        .limit(1),
    );
    return (rows?.length ?? 0) > 0;
  }

  async getMyRoles(): Promise<readonly AdminRole[]> {
    return fetchMyAdminRoles(this.client);
  }

  async restoreTarget(targetType: ModerationTargetType, targetId: string): Promise<void> {
    if (targetType === 'post') {
      await this.call('rpc:admin_restore_post', () => this.client.rpc('admin_restore_post', { p_post_id: targetId }));
    } else if (targetType === 'user') {
      await this.call('rpc:admin_restore_user', () => this.client.rpc('admin_restore_user', { p_user_id: targetId }));
    } else {
      // The baseline has no staff restore of a chat: a dismissed report restores it server-side.
      throw new BackendUnavailableError('rpc:admin_restore_chat', 'function');
    }
  }

  async dismissReport(reportId: string): Promise<void> {
    await this.call('rpc:admin_dismiss_report', () =>
      this.client.rpc('admin_dismiss_report', { p_report_id: reportId }));
  }

  async confirmReport(reportId: string): Promise<void> {
    await this.call('rpc:admin_confirm_report', () =>
      this.client.rpc('admin_confirm_report', { p_report_id: reportId }));
  }

  async banUser(userId: string, reason: BanReason, note: string): Promise<void> {
    // `p_note` is optional on the server; an empty note is sent as "no note".
    const trimmed = note.trim();
    await this.call('rpc:admin_ban_user', () =>
      this.client.rpc('admin_ban_user', {
        p_user_id: userId,
        p_reason: reason,
        ...(trimmed === '' ? {} : { p_note: trimmed }),
      }));
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.call('rpc:admin_delete_message', () =>
      this.client.rpc('admin_delete_message', { p_message_id: messageId }));
  }

  async auditLookup(userId: string, limit = 200): Promise<readonly AuditEvent[]> {
    let rows;
    try {
      rows = await callAuditSearch(this.client, { p_target_id: userId, p_limit: limit });
    } catch (error) {
      throw toModerationError(error);
    }
    return rows.map((row) => ({
      eventId: String(row.id),
      actorId: row.actor_id ?? null,
      action: row.action as AuditEvent['action'],
      targetType: (row.target_type as AuditEvent['targetType']) ?? null,
      targetId: row.target_id ?? null,
      metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {}) as Record<string, unknown>,
      createdAt: row.occurred_at,
    }));
  }
}
