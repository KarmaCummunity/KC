import { describe, expect, it } from 'vitest';
import { supportCounterpartOf, type ReportCaseDetail, type ReportCaseReporter } from '../ReportCaseDetail';

const reporter = (reporterId: string | null): ReportCaseReporter => ({
  reportId: `r-${reporterId}`, reporterId, reporterName: null, reason: 'Spam', note: null,
  status: 'open', createdAt: '2026-11-11T10:00:00Z', resolvedAt: null, resolvedBy: null,
});

const detail = (overrides: Partial<ReportCaseDetail>): ReportCaseDetail => ({
  targetType: 'post', targetId: 't1', target: {}, reporters: [], timeline: [], ...overrides,
});

describe('supportCounterpartOf (FR-ADMIN-013 AC2 "Open support thread")', () => {
  it('is the reported member on a member case', () => {
    expect(supportCounterpartOf(detail({ targetType: 'user', targetId: 'u9', reporters: [reporter('r1')] }))).toBe('u9');
  });

  it('is the author of a reported post or comment', () => {
    expect(supportCounterpartOf(detail({ target: { author_id: 'a1' }, reporters: [reporter('r1')] }))).toBe('a1');
    expect(supportCounterpartOf(detail({ targetType: 'comment', target: { author_id: 'a2' } }))).toBe('a2');
  });

  it('falls back to the reporter who reported last, skipping purged reporters', () => {
    expect(supportCounterpartOf(detail({
      targetType: 'chat', reporters: [reporter('r1'), reporter('r2'), reporter(null)],
    }))).toBe('r2');
  });

  it('is null when nobody is left', () => {
    expect(supportCounterpartOf(detail({ targetType: 'chat', reporters: [reporter(null)] }))).toBeNull();
  });
});
