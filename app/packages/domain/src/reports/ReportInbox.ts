import type { ReportTargetType } from '../value-objects';

export const AUTO_REMOVE_THRESHOLD = 3 as const;

/**
 * The target types that may appear in the admin inbox / case detail surfaces: the four
 * values `reports.target_type` accepts. A listing is a post, so there is no `listing` case.
 */
export type AdminReportTargetType = Extract<ReportTargetType, 'post' | 'user' | 'chat' | 'comment'>;

export interface ReportThresholdProgress {
  readonly count: number;
  readonly threshold: number;
  readonly pct: number;  // 0..1
}

export function thresholdProgress(count: number): ReportThresholdProgress {
  const capped = Math.min(count, AUTO_REMOVE_THRESHOLD);
  return {
    count,
    threshold: AUTO_REMOVE_THRESHOLD,
    pct: capped / AUTO_REMOVE_THRESHOLD,
  };
}

export interface ReportInboxRow {
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
  readonly reporterCount: number;
  readonly oldestAt: string;       // ISO timestamp
  readonly latestReporterId: string | null;
  readonly target: Readonly<Record<string, unknown>>;
}

export interface ReportInboxCursor {
  readonly oldestAt: string;
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
}

export interface ReportInboxPage {
  readonly rows: readonly ReportInboxRow[];
  readonly nextCursor: ReportInboxCursor | null;
}

/** One open report as the staff read of `reports` returns it. */
export interface OpenReportRecord {
  readonly reporterId: string | null;
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
  readonly createdAt: string;      // ISO timestamp
}

/** An inbox case before its target preview is attached. */
export type ReportInboxGroup = Omit<ReportInboxRow, 'target'>;

/** Total order of the inbox: oldest case first, ties broken by target type and id. */
function compareGroups(a: ReportInboxGroup | ReportInboxCursor, b: ReportInboxGroup | ReportInboxCursor): number {
  if (a.oldestAt !== b.oldestAt) return a.oldestAt < b.oldestAt ? -1 : 1;
  if (a.targetType !== b.targetType) return a.targetType < b.targetType ? -1 : 1;
  if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : 1;
  return 0;
}

/**
 * Folds open reports into one case per target (FR-ADMIN-013 AC3: each case is independent).
 * The server has no inbox function, so the grouping lives here: `reporterCount` counts distinct
 * reporters, `oldestAt` is the first report of the case, `latestReporterId` the newest report's
 * reporter. The result is sorted oldest case first (the order the staff work it).
 */
export function groupOpenReports(reports: readonly OpenReportRecord[]): ReportInboxGroup[] {
  const byTarget = new Map<string, OpenReportRecord[]>();
  for (const report of reports) {
    const key = `${report.targetType}:${report.targetId}`;
    const bucket = byTarget.get(key);
    if (bucket) bucket.push(report);
    else byTarget.set(key, [report]);
  }
  const groups: ReportInboxGroup[] = [];
  for (const bucket of byTarget.values()) {
    // Oldest first, so index 0 is the case's first report and the last element its newest.
    const sorted = [...bucket].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const first = sorted[0]!;
    const newest = sorted[sorted.length - 1]!;
    groups.push({
      targetType: first.targetType,
      targetId: first.targetId,
      reporterCount: new Set(sorted.map((r) => r.reporterId ?? `purged:${r.createdAt}`)).size,
      oldestAt: first.createdAt,
      latestReporterId: newest.reporterId,
    });
  }
  return groups.sort(compareGroups);
}

/**
 * One page of `groups` (already sorted by {@link groupOpenReports}) after `cursor`. The cursor
 * is the last case of the previous page; a cursor that no longer matches a case (it was
 * resolved meanwhile) still resumes at the right place because the order is total.
 */
export function pageInboxGroups(
  groups: readonly ReportInboxGroup[],
  cursor: ReportInboxCursor | null,
  limit: number,
): { readonly groups: readonly ReportInboxGroup[]; readonly nextCursor: ReportInboxCursor | null } {
  const start = cursor === null ? 0 : groups.findIndex((g) => compareGroups(g, cursor) > 0);
  const remaining = start < 0 ? [] : groups.slice(start);
  const page = remaining.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = remaining.length > page.length;
  return {
    groups: page,
    nextCursor: hasMore && last
      ? { oldestAt: last.oldestAt, targetType: last.targetType, targetId: last.targetId }
      : null,
  };
}
