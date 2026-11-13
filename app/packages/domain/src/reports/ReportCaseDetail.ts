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
  /** Preview of the target: a post, member or comment, or a chat's hidden-for-review time (never its messages). */
  readonly target: Readonly<Record<string, unknown>>;
  readonly reporters: readonly ReportCaseReporter[];
  readonly timeline: readonly ReportCaseAuditEntry[];
}

/**
 * The member whose support thread "Open support thread" opens on a case (FR-ADMIN-013 AC2): the
 * reported member, the author of a reported post or comment, or else (a chat) the reporter who
 * reported last. Null when nobody is left to talk to.
 */
export function supportCounterpartOf(detail: ReportCaseDetail): string | null {
  if (detail.targetType === 'user') return detail.targetId;
  const author = detail.target['author_id'];
  if (typeof author === 'string' && author !== '') return author;
  for (let i = detail.reporters.length - 1; i >= 0; i -= 1) {
    const reporterId = detail.reporters[i]?.reporterId;
    if (reporterId) return reporterId;
  }
  return null;
}
