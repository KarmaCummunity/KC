import { reportMachine } from '../fsm/machines/report';
import type { ReportStatus } from '../value-objects';
import type { AdminReportTargetType } from './ReportInbox';

/** The report lifecycle as the admin console reads it (`reportMachine`). */
export type AdminReportStatus = ReportStatus;

export interface ReportCaseReporter {
  readonly reportId: string;
  readonly reporterId: string;
  readonly reporterName: string | null;
  readonly reason: string;
  readonly note: string | null;
  readonly status: AdminReportStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export interface ReportCaseAuditEntry {
  readonly eventId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ReportCaseDetail {
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly reporters: readonly ReportCaseReporter[];
  readonly timeline: readonly ReportCaseAuditEntry[];
}

const REPORT_STATES: readonly string[] = reportMachine.states;

function isAdminReportStatus(v: unknown): v is AdminReportStatus {
  return typeof v === 'string' && REPORT_STATES.includes(v);
}

function parseReporters(raw: unknown): ReportCaseReporter[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportCaseReporter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['report_id'] !== 'string' || typeof r['reporter_id'] !== 'string') continue;
    out.push({
      reportId:    r['report_id'],
      reporterId:  r['reporter_id'],
      reporterName: typeof r['reporter_name'] === 'string' ? r['reporter_name'] : null,
      reason:      typeof r['reason'] === 'string' ? r['reason'] : '',
      note:        typeof r['note'] === 'string' ? r['note'] : null,
      status:      isAdminReportStatus(r['status']) ? r['status'] : 'open',
      createdAt:   typeof r['created_at'] === 'string' ? r['created_at'] : '',
      resolvedAt:  typeof r['resolved_at'] === 'string' ? r['resolved_at'] : null,
      resolvedBy:  typeof r['resolved_by'] === 'string' ? r['resolved_by'] : null,
    });
  }
  return out;
}

function parseTimeline(raw: unknown): ReportCaseAuditEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportCaseAuditEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e['event_id'] !== 'string') continue;
    out.push({
      eventId:    e['event_id'],
      actorId:    typeof e['actor_id'] === 'string' ? e['actor_id'] : null,
      action:     typeof e['action'] === 'string' ? e['action'] : '',
      metadata:   (e['metadata'] && typeof e['metadata'] === 'object') ? e['metadata'] as Record<string, unknown> : {},
      createdAt:  typeof e['created_at'] === 'string' ? e['created_at'] : '',
    });
  }
  return out;
}

export function parseReportCaseDetail(input: unknown): ReportCaseDetail | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const tt = obj['target_type'];
  if (tt !== 'post' && tt !== 'user' && tt !== 'chat') return null;
  if (typeof obj['target_id'] !== 'string') return null;

  return {
    targetType: tt,
    targetId:   obj['target_id'],
    target:     (obj['target'] && typeof obj['target'] === 'object') ? obj['target'] as Record<string, unknown> : {},
    reporters:  parseReporters(obj['reporters']),
    timeline:   parseTimeline(obj['timeline']),
  };
}
