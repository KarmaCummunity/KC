import { describe, expect, it } from 'vitest';
import {
  REPORT_SLA_DEADLINE_HOURS,
  REPORT_SLA_WARNING_HOURS,
  reportSlaState,
} from '../ReportSla';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// FR-ADMIN-012 AC5 — store review expects a reported item to be acted on within 24 h.
describe('reportSlaState', () => {
  it('keeps the thresholds at 12 h (warning) and 24 h (deadline)', () => {
    expect(REPORT_SLA_WARNING_HOURS).toBe(12);
    expect(REPORT_SLA_DEADLINE_HOURS).toBe(24);
  });

  it('is on track below 12 h', () => {
    expect(reportSlaState(hoursAgo(0), NOW)).toBe('on_track');
    expect(reportSlaState(hoursAgo(11.99), NOW)).toBe('on_track');
  });

  it('warns from 12 h up to, not including, 24 h', () => {
    expect(reportSlaState(hoursAgo(12), NOW)).toBe('warning');
    expect(reportSlaState(hoursAgo(23.99), NOW)).toBe('warning');
  });

  it('is overdue from 24 h', () => {
    expect(reportSlaState(hoursAgo(24), NOW)).toBe('overdue');
    expect(reportSlaState(hoursAgo(24 * 7), NOW)).toBe('overdue');
  });

  it('treats a timestamp in the future or an unparsable one as on track, never as overdue', () => {
    expect(reportSlaState(hoursAgo(-3), NOW)).toBe('on_track');
    expect(reportSlaState('not-a-date', NOW)).toBe('on_track');
  });
});
