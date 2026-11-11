import type { SupabaseClient } from '@supabase/supabase-js';
import type { IReportsRepository, ListOpenReportsFilters } from '@kc/application';
import {
  groupOpenReports, pageInboxGroups, reportMachine,
  type AdminReportStatus, type AdminReportTargetType, type OpenReportRecord,
  type ReportCaseAuditEntry, type ReportCaseDetail, type ReportCaseReporter,
  type ReportInboxCursor, type ReportInboxPage,
} from '@kc/domain';
import type { Database } from '../database.types';
import { callAuditSearch } from '../admin/auditSearchCall';
import { unwrapCall } from '../rpc/mapRpcError';
import { loadDisplayNames, loadTargetPreviews, previewKey } from './reportTargetPreviews';

type Client = SupabaseClient<Database>;

/**
 * Open reports read per inbox page. The server has no inbox function, so cases are grouped on
 * the device from the oldest open reports (the order staff work them). Past this many open
 * reports the newest ones wait until older cases are resolved.
 */
const INBOX_SCAN_LIMIT = 1000;
/** Audit events shown on a case timeline. */
const TIMELINE_LIMIT = 50;
const DAY_MS = 86_400_000;

const REPORT_TARGET_TYPES: readonly string[] = ['post', 'user', 'chat', 'comment'];
const REPORT_STATES: readonly string[] = reportMachine.states;

const asTargetType = (value: string): AdminReportTargetType | null =>
  REPORT_TARGET_TYPES.includes(value) ? (value as AdminReportTargetType) : null;

const asStatus = (value: string): AdminReportStatus =>
  REPORT_STATES.includes(value) ? (value as AdminReportStatus) : 'open';

/** Staff reads of `reports` and of the targets under `reports_select_staff` and its siblings (FR-ADMIN-012, FR-ADMIN-013). */
export class SupabaseReportsRepository implements IReportsRepository {
  constructor(private readonly client: Client) {}

  async listOpenInbox(
    filters: ListOpenReportsFilters,
    cursor: ReportInboxCursor | null,
    limit: number,
  ): Promise<ReportInboxPage> {
    let query = this.client
      .from('reports')
      .select('reporter_id, target_type, target_id, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(INBOX_SCAN_LIMIT);
    if (filters.targetType) query = query.eq('target_type', filters.targetType);
    if (filters.reporterId) query = query.eq('reporter_id', filters.reporterId);
    if (filters.maxAgeDays) {
      query = query.gte('created_at', new Date(Date.now() - filters.maxAgeDays * DAY_MS).toISOString());
    }
    const rows = unwrapCall('table:reports', await query) ?? [];

    const records: OpenReportRecord[] = [];
    for (const row of rows) {
      const targetType = asTargetType(row.target_type);
      if (targetType) {
        records.push({ reporterId: row.reporter_id, targetType, targetId: row.target_id, createdAt: row.created_at });
      }
    }
    const page = pageInboxGroups(groupOpenReports(records), cursor, limit);
    const previews = await loadTargetPreviews(this.client, page.groups);
    return {
      rows: page.groups.map((group) => ({ ...group, target: previews.get(previewKey(group)) ?? {} })),
      nextCursor: page.nextCursor,
    };
  }

  async getCaseDetail(targetType: AdminReportTargetType, targetId: string): Promise<ReportCaseDetail | null> {
    const reports = unwrapCall(
      'table:reports',
      await this.client
        .from('reports')
        .select('id, reporter_id, reason, note, status, created_at, resolved_at, resolved_by')
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .order('created_at', { ascending: true }),
    ) ?? [];
    if (reports.length === 0) return null;

    const names = await loadDisplayNames(this.client, reports.flatMap((r) => (r.reporter_id ? [r.reporter_id] : [])));
    const previews = await loadTargetPreviews(this.client, [{ targetType, targetId }]);
    const reporters: ReportCaseReporter[] = reports.map((r) => ({
      reportId: r.id,
      reporterId: r.reporter_id,
      reporterName: r.reporter_id ? names.get(r.reporter_id) ?? null : null,
      reason: r.reason,
      note: r.note,
      status: asStatus(r.status),
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
    }));
    return {
      targetType,
      targetId,
      target: previews.get(previewKey({ targetType, targetId })) ?? {},
      reporters,
      timeline: await this.loadTimeline(targetId),
    };
  }

  /** Audit events about the target, oldest first. The server scopes them by the caller's role. */
  private async loadTimeline(targetId: string): Promise<ReportCaseAuditEntry[]> {
    const events = await callAuditSearch(this.client, { p_target_id: targetId, p_limit: TIMELINE_LIMIT });
    return events
      .map((e) => ({
        eventId: String(e.id),
        actorId: e.actor_id ?? null,
        action: e.action,
        metadata: (e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata)
          ? e.metadata
          : {}) as Record<string, unknown>,
        createdAt: e.occurred_at,
      }))
      .reverse();
  }
}
