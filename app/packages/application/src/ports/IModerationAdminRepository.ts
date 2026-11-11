import type { AdminRole, AuditEvent } from '@kc/domain';

/** What staff can restore. A listing is a post; a comment or a message has no restore. */
export type ModerationTargetType = 'post' | 'user' | 'chat';
export type BanReason = 'spam' | 'harassment' | 'policy_violation' | 'other';

export interface IModerationAdminRepository {
  /** The caller's own active admin roles — for defence-in-depth permission
   *  checks against the @kc/domain PERMISSION_MATRIX (FR-ADMIN-006). */
  getMyRoles(): Promise<readonly AdminRole[]>;
  restoreTarget(targetType: ModerationTargetType, targetId: string): Promise<void>;
  dismissReport(reportId: string): Promise<void>;
  confirmReport(reportId: string): Promise<void>;
  banUser(userId: string, reason: BanReason, note: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  auditLookup(userId: string, limit?: number): Promise<readonly AuditEvent[]>;
  /** True if the target holds an active platform staff role. Defence-in-depth check used by
   *  BanUserUseCase before the DB refuses with `cannot_sanction_admin`. */
  isPlatformStaff(userId: string): Promise<boolean>;
}
