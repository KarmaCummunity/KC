import type { SupabaseClient } from '@supabase/supabase-js';
import type { IReportsRepository, ListOpenReportsFilters } from '@kc/application';
import {
  reportMachine,
  type AdminReportStatus, type AdminReportTargetType, type ReportCaseAuditEntry, type ReportCaseDetail,
  type ReportCaseReporter, type ReportInboxCursor, type ReportInboxGroup, type ReportInboxPage,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { loadDisplayNames, loadTargetPreviews, previewKey } from './reportTargetPreviews';

type Client = SupabaseClient<Database>;

/** Audit events shown on a case timeline (the newest ones, oldest first). */
const TIMELINE_LIMIT = 100;

const REPORT_TARGET_TYPES: readonly string[] = ['post', 'user', 'chat', 'comment'];
const REPORT_STATES: readonly string[] = reportMachine.states;

const asTargetType = (value: string): AdminReportTargetType | null =>
  REPORT_TARGET_TYPES.includes(value) ? (value as AdminReportTargetType) : null;

const asStatus = (value: string): AdminReportStatus =>
  REPORT_STATES.includes(value) ? (value as AdminReportStatus) : 'open';

/** Staff reads of `reports` and of the targets under `reports_select_staff` and its siblings (FR-ADMIN-012, FR-ADMIN-013). */
export class SupabaseReportsRepository implements IReportsRepository {
  constructor(private readonly client: Client) {}

  /**
   * One page of cases from `admin_reports_inbox` (0016): grouped, filtered and keyset paged on the
   * server over every open report, oldest case first. Previews are read for the page's targets.
   */
  async listOpenInbox(
    filters: ListOpenReportsFilters,
    cursor: ReportInboxCursor | null,
    limit: number,
  ): Promise<ReportInboxPage> {
    const search = filters.search?.trim();
    const rows = unwrapCall('rpc:admin_reports_inbox', await this.client.rpc('admin_reports_inbox', {
      p_target_type: filters.targetType ?? undefined,
      p_max_age_days: filters.maxAgeDays ?? undefined,
      p_reporter_id: filters.reporterId?.trim() || undefined,
      p_search: search || undefined,
      p_after_oldest_at: cursor?.oldestAt,
      p_after_target_type: cursor?.targetType,
      p_after_target_id: cursor?.targetId,
      p_limit: limit,
    })) ?? [];

    const groups: ReportInboxGroup[] = [];
    for (const row of rows) {
      const targetType = asTargetType(row.target_type);
      if (!targetType) continue;
      groups.push({
        targetType,
        targetId: row.target_id,
        reporterCount: row.reporter_count,
        oldestAt: row.oldest_at,
        latestReporterId: row.latest_reporter_id ?? null,
      });
    }
    const previews = await loadTargetPreviews(this.client, groups);
    const last = rows[rows.length - 1];
    return {
      rows: groups.map((group) => ({ ...group, target: previews.get(previewKey(group)) ?? {} })),
      nextCursor: rows.length === limit && last && asTargetType(last.target_type)
        ? { oldestAt: last.oldest_at, targetType: last.target_type as AdminReportTargetType, targetId: last.target_id }
        : null,
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
      timeline: await this.loadTimeline(targetType, targetId),
    };
  }

  /**
   * The case history from `admin_report_case_timeline` (0016), oldest first: what was done to the
   * target and its reports, whoever acted, for every staff role that reads the case.
   */
  private async loadTimeline(targetType: AdminReportTargetType, targetId: string): Promise<ReportCaseAuditEntry[]> {
    const events = unwrapCall('rpc:admin_report_case_timeline', await this.client.rpc('admin_report_case_timeline', {
      p_target_type: targetType, p_target_id: targetId, p_limit: TIMELINE_LIMIT,
    })) ?? [];
    return events.map((e) => ({
      eventId: String(e.id),
      actorId: e.actor_id ?? null,
      action: e.action,
      metadata: (e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata)
        ? e.metadata
        : {}) as Record<string, unknown>,
      createdAt: e.occurred_at,
    }));
  }
}
