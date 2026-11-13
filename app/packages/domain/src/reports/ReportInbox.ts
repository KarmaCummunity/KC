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

/** An inbox case before its target preview is attached (one row of `admin_reports_inbox`). */
export type ReportInboxGroup = Omit<ReportInboxRow, 'target'>;
