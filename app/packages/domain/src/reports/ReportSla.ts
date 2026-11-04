/**
 * Report-handling clock for the admin inbox (FR-ADMIN-012 AC5). Apple and Google expect a
 * reported item to be acted on within 24 h, so the inbox warns at 12 h and flags 24 h as overdue.
 * The same 12 h threshold drives the server alert (`report_sla_alert_sweep`, migration 0611).
 */
export const REPORT_SLA_WARNING_HOURS = 12 as const;
export const REPORT_SLA_DEADLINE_HOURS = 24 as const;

export type ReportSlaState = 'on_track' | 'warning' | 'overdue';

const HOUR_MS = 3_600_000;

/** State of a case whose oldest open report was filed at `oldestAt` (ISO timestamp). */
export function reportSlaState(oldestAt: string, now: Date = new Date()): ReportSlaState {
  const filed = new Date(oldestAt).getTime();
  if (Number.isNaN(filed)) return 'on_track';
  const waitedHours = (now.getTime() - filed) / HOUR_MS;
  if (waitedHours >= REPORT_SLA_DEADLINE_HOURS) return 'overdue';
  if (waitedHours >= REPORT_SLA_WARNING_HOURS) return 'warning';
  return 'on_track';
}
