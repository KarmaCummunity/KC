import { describe, expect, it } from 'vitest';
import { AUTO_REMOVE_THRESHOLD, thresholdProgress } from '../ReportInbox';

// The inbox is grouped and paged on the server (`admin_reports_inbox`, migration 0016,
// pgTAP 064_report_case_tools); what stays in the domain is the threshold progress.
describe('ReportInbox', () => {
  it('AUTO_REMOVE_THRESHOLD is 3', () => {
    expect(AUTO_REMOVE_THRESHOLD).toBe(3);
  });

  it('thresholdProgress caps at the threshold', () => {
    expect(thresholdProgress(0)).toEqual({ count: 0, threshold: 3, pct: 0 });
    expect(thresholdProgress(2)).toEqual({ count: 2, threshold: 3, pct: 2 / 3 });
    expect(thresholdProgress(3)).toEqual({ count: 3, threshold: 3, pct: 1 });
    expect(thresholdProgress(99)).toEqual({ count: 99, threshold: 3, pct: 1 });
  });
});
