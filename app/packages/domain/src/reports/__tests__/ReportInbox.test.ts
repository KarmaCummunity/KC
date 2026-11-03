import { describe, expect, it } from 'vitest';
import {
  parseReportInboxPage, AUTO_REMOVE_THRESHOLD, thresholdProgress,
  type ReportInboxRow,
} from '../ReportInbox';

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

  it('parseReportInboxPage returns an empty page on malformed input', () => {
    expect(parseReportInboxPage(null)).toEqual({ rows: [], nextCursor: null });
    expect(parseReportInboxPage({})).toEqual({ rows: [], nextCursor: null });
    expect(parseReportInboxPage({ rows: 'oops' })).toEqual({ rows: [], nextCursor: null });
  });

  it('parseReportInboxPage filters invalid rows and preserves valid ones', () => {
    const input = {
      rows: [
        { target_type: 'post', target_id: 'a-uuid', reporter_count: 2, oldest_at: '2026-05-25T10:00:00Z', latest_reporter_id: 'b', target: { preview: 'hi' } },
        { target_type: 'unknown', target_id: 'x' },              // dropped
        { target_id: 'no-type' },                                // dropped
      ],
      next_cursor: { oldest_at: '2026-05-25T09:00:00Z', target_type: 'post', target_id: 'c' },
    };
    const out = parseReportInboxPage(input);
    expect(out.rows).toHaveLength(1);
    const first = out.rows[0]!;
    expect(first.targetType).toBe<ReportInboxRow['targetType']>('post');
    expect(out.nextCursor?.targetType).toBe('post');
  });

  it('handles row fallback defaults and malformed cursors', () => {
    const input = {
      rows: [
        null,
        'string-row',
        {
          target_type: 'user',
          target_id: 'u-1',
          reporter_count: 'not-a-number',
          oldest_at: null,
          latest_reporter_id: 123,
          target: null,
        },
      ],
      next_cursor: { oldest_at: 123, target_type: 'post', target_id: 'c' },
    };
    const out = parseReportInboxPage(input);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({
      targetType: 'user',
      targetId: 'u-1',
      reporterCount: 0,
      oldestAt: '',
      latestReporterId: null,
      target: {},
    });
    expect(out.nextCursor).toBeNull();
  });
});
