import { describe, expect, it } from 'vitest';
import { parseReportCaseDetail } from '../ReportCaseDetail';

describe('parseReportCaseDetail', () => {
  it('returns null for non-objects and invalid target_type', () => {
    expect(parseReportCaseDetail(null)).toBeNull();
    expect(parseReportCaseDetail('x')).toBeNull();
    expect(parseReportCaseDetail({ target_type: 'org', target_id: '1' })).toBeNull();
    expect(parseReportCaseDetail({ target_type: 'post' })).toBeNull();
  });

  it('parses a full case with reporters and timeline', () => {
    const detail = parseReportCaseDetail({
      target_type: 'post',
      target_id: 'p1',
      target: { title: 'hi' },
      reporters: [
        {
          report_id: 'r1',
          reporter_id: 'u1',
          reporter_name: 'A',
          reason: 'spam',
          note: 'n',
          status: 'open',
          created_at: '2026-01-01T00:00:00Z',
          resolved_at: null,
          resolved_by: null,
        },
        { report_id: 1 }, // skipped — bad types
        null,
      ],
      timeline: [
        {
          event_id: 'e1',
          actor_id: 'admin',
          action: 'opened',
          metadata: { k: 1 },
          created_at: '2026-01-01T00:00:00Z',
        },
        { event_id: 2 }, // skipped
      ],
    });
    expect(detail).not.toBeNull();
    expect(detail!.targetType).toBe('post');
    expect(detail!.targetId).toBe('p1');
    expect(detail!.target).toEqual({ title: 'hi' });
    expect(detail!.reporters).toHaveLength(1);
    const reporter = detail!.reporters[0]!;
    expect(reporter.reportId).toBe('r1');
    expect(reporter.status).toBe('open');
    expect(detail!.timeline).toHaveLength(1);
    expect(detail!.timeline[0]!.action).toBe('opened');
  });

  it('defaults reporter status to open when unknown and empty arrays when missing', () => {
    const detail = parseReportCaseDetail({
      target_type: 'user',
      target_id: 'u9',
      reporters: [
        {
          report_id: 'r2',
          reporter_id: 'u2',
          status: 'weird',
        },
      ],
    });
    const reporter = detail!.reporters[0]!;
    expect(reporter.status).toBe('open');
    expect(reporter.reason).toBe('');
    expect(detail!.timeline).toEqual([]);
  });

  it('handles resolved reporter fields, invalid timeline entries, and non-array collections', () => {
    const detail = parseReportCaseDetail({
      target_type: 'chat',
      target_id: 'c1',
      target: null,
      reporters: [
        {
          report_id: 'r3',
          reporter_id: 'u3',
          status: 'confirmed_violation',
          resolved_at: '2026-01-02T00:00:00Z',
          resolved_by: 'admin_1',
        },
      ],
      timeline: [
        null,
        'not-an-object',
        {
          event_id: 'e2',
          actor_id: 123,
          action: null,
          metadata: 'invalid-meta',
          created_at: 456,
        },
      ],
    });
    expect(detail).not.toBeNull();
    expect(detail!.target).toEqual({});
    expect(detail!.reporters[0]!.resolvedAt).toBe('2026-01-02T00:00:00Z');
    expect(detail!.reporters[0]!.resolvedBy).toBe('admin_1');
    expect(detail!.timeline).toHaveLength(1);
    expect(detail!.timeline[0]).toEqual({
      eventId: 'e2',
      actorId: null,
      action: '',
      metadata: {},
      createdAt: '',
    });

    const nonArrayDetail = parseReportCaseDetail({
      target_type: 'post',
      target_id: 'p2',
      reporters: 'not-array',
      timeline: null,
    });
    expect(nonArrayDetail!.reporters).toEqual([]);
    expect(nonArrayDetail!.timeline).toEqual([]);
  });
});
