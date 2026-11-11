import type { ReportStatus } from '../value-objects';
import type { AdminReportTargetType } from './ReportInbox';

/** The report lifecycle as the admin console reads it (`reportMachine`). */
export type AdminReportStatus = ReportStatus;

export interface ReportCaseReporter {
  readonly reportId: string;
  /** Null once the reporter's account was purged: the report stays (design §4.1). */
  readonly reporterId: string | null;
  readonly reporterName: string | null;
  readonly reason: string;
  readonly note: string | null;
  readonly status: AdminReportStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export interface ReportCaseAuditEntry {
  /** Audit event id (a bigint on the server, carried as a string). */
  readonly eventId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ReportCaseDetail {
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
  /** Preview of the target (post, member or comment); empty for a chat, which staff cannot read. */
  readonly target: Readonly<Record<string, unknown>>;
  readonly reporters: readonly ReportCaseReporter[];
  readonly timeline: readonly ReportCaseAuditEntry[];
}
