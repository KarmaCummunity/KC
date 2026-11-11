import { describe, expect, it } from 'vitest';
import {
  AUTO_REMOVE_THRESHOLD, thresholdProgress, groupOpenReports, pageInboxGroups,
  type OpenReportRecord,
} from '../ReportInbox';

const report = (
  targetId: string, createdAt: string, reporterId: string | null = 'r1',
  targetType: OpenReportRecord['targetType'] = 'post',
): OpenReportRecord => ({ reporterId, targetType, targetId, createdAt });

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

  describe('groupOpenReports', () => {
    it('folds the reports of one target into one case', () => {
      const groups = groupOpenReports([
        report('p1', '2026-11-01T10:00:00Z', 'a'),
        report('p1', '2026-11-01T12:00:00Z', 'b'),
        report('p1', '2026-11-01T11:00:00Z', 'a'),
      ]);
      expect(groups).toEqual([{
        targetType: 'post', targetId: 'p1', reporterCount: 2,
        oldestAt: '2026-11-01T10:00:00Z', latestReporterId: 'b',
      }]);
    });

    it('keeps the same id of different target types as separate cases', () => {
      const groups = groupOpenReports([
        report('x', '2026-11-01T10:00:00Z', 'a', 'post'),
        report('x', '2026-11-01T10:00:00Z', 'a', 'user'),
      ]);
      expect(groups.map((g) => g.targetType)).toEqual(['post', 'user']);
    });

    it('sorts the oldest case first', () => {
      const groups = groupOpenReports([
        report('late', '2026-11-02T00:00:00Z'),
        report('early', '2026-11-01T00:00:00Z'),
      ]);
      expect(groups.map((g) => g.targetId)).toEqual(['early', 'late']);
    });

    it('counts reports whose reporter account was purged as separate reporters', () => {
      const groups = groupOpenReports([
        report('p1', '2026-11-01T10:00:00Z', null),
        report('p1', '2026-11-01T11:00:00Z', null),
      ]);
      expect(groups[0]?.reporterCount).toBe(2);
      expect(groups[0]?.latestReporterId).toBeNull();
    });

    it('returns no case for no report', () => {
      expect(groupOpenReports([])).toEqual([]);
    });
  });

  describe('pageInboxGroups', () => {
    const groups = groupOpenReports(
      ['a', 'b', 'c'].map((id, i) => report(id, `2026-11-0${i + 1}T00:00:00Z`)),
    );

    it('returns the first page and a cursor on the last case when more remain', () => {
      const page = pageInboxGroups(groups, null, 2);
      expect(page.groups.map((g) => g.targetId)).toEqual(['a', 'b']);
      expect(page.nextCursor).toEqual({ oldestAt: '2026-11-02T00:00:00Z', targetType: 'post', targetId: 'b' });
    });

    it('resumes after the cursor and ends with a null cursor', () => {
      const first = pageInboxGroups(groups, null, 2);
      const second = pageInboxGroups(groups, first.nextCursor, 2);
      expect(second.groups.map((g) => g.targetId)).toEqual(['c']);
      expect(second.nextCursor).toBeNull();
    });

    it('resumes correctly when the cursor case was resolved meanwhile', () => {
      const cursor = { oldestAt: '2026-11-01T12:00:00Z', targetType: 'post' as const, targetId: 'gone' };
      expect(pageInboxGroups(groups, cursor, 5).groups.map((g) => g.targetId)).toEqual(['b', 'c']);
    });

    it('returns an empty page past the end', () => {
      const cursor = { oldestAt: '2027-01-01T00:00:00Z', targetType: 'post' as const, targetId: 'z' };
      expect(pageInboxGroups(groups, cursor, 5)).toEqual({ groups: [], nextCursor: null });
    });
  });
});
