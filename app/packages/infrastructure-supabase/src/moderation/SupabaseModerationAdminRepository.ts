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
import type { AdminRole, AuditEvent } from '@kc/domain';
import { fetchMyAdminRoles } from '../admin/fetchMyAdminRoles';
import type { Database } from '../database.legacy.types';

/**
 * FR-MOD-010 / FR-ADMIN-002..007 — Supabase adapter for admin moderation
 * actions. Delegates to RPCs from migrations 0034-0040 and maps custom
 * SQLSTATEs to typed domain errors.
 */
export class SupabaseModerationAdminRepository implements IModerationAdminRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  // Custom SQLSTATEs raised by the migrations 0034-0040 RPCs. We map by code
  // only — never match on `error.message` (brittle to localisation / wording).
  private static readonly CODE_MAP: Record<string, ModerationError['code']> = {
    '42501': 'forbidden',
    P0010: 'invalid_target_type',
    P0011: 'invalid_restore_state',
    P0012: 'report_not_open',
    P0013: 'cannot_ban_self',
    P0014: 'cannot_ban_admin',
    P0015: 'invalid_ban_reason',
    P0016: 'cannot_delete_system_message',
    P0017: 'target_not_found',
  };

  private mapError(error: { code?: string; message: string }, raw?: unknown): never {
    const code = error.code ? SupabaseModerationAdminRepository.CODE_MAP[error.code] : undefined;
    if (code === 'forbidden') throw new ModerationForbiddenError(raw);
    if (code === 'invalid_restore_state') throw new InvalidRestoreStateError(raw);
    if (code) throw new ModerationError(code, error.message, raw);
    throw new ModerationError('unknown', error.message, raw);
  }

  async isUserAdmin(userId: string): Promise<boolean> {
    // TD-163: the `is_super_admin` column is no longer client-readable
    // (migration 0163 revoked the SELECT grant). Resolve admin status via the
    // SECURITY DEFINER `is_admin(uid)` RPC, which bypasses the column grant.
    const { data, error } = await this.client.rpc('is_admin', { uid: userId });
    if (error) this.mapError(error, error);
    return data === true;
  }

  async getMyRoles(): Promise<readonly AdminRole[]> {
    return fetchMyAdminRoles(this.client);
  }

  async restoreTarget(targetType: ModerationTargetType, targetId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_restore_target', {
      p_target_type: targetType,
      p_target_id: targetId,
    });
    if (error) this.mapError(error, error);
  }

  async removeListing(listingId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_remove_listing', { p_listing_id: listingId });
    if (error) this.mapError(error, error);
  }

  async dismissReport(reportId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_dismiss_report', { p_report_id: reportId });
    if (error) this.mapError(error, error);
  }

  async confirmReport(reportId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_confirm_report', { p_report_id: reportId });
    if (error) this.mapError(error, error);
  }

  async banUser(userId: string, reason: BanReason, note: string): Promise<void> {
    const { error } = await this.client.rpc('admin_ban_user', {
      p_target_user_id: userId,
      p_reason: reason,
      p_note: note,
    });
    if (error) this.mapError(error, error);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_delete_message', { p_message_id: messageId });
    if (error) this.mapError(error, error);
  }

  async auditLookup(userId: string, limit = 200): Promise<readonly AuditEvent[]> {
    const { data, error } = await this.client.rpc('admin_audit_lookup_guarded', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) this.mapError(error, error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      eventId: row.event_id as string,
      actorId: (row.actor_id as string | null) ?? null,
      action: row.action as AuditEvent['action'],
      targetType: (row.target_type as AuditEvent['targetType']) ?? null,
      targetId: (row.target_id as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown> | null) ?? {},
      createdAt: row.created_at as string,
    }));
  }
}
