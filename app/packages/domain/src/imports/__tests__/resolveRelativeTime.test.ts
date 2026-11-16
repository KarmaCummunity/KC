import { describe, expect, it } from 'vitest';
import { resolveTimeHint } from '../resolveRelativeTime';
import type { ExtractedTimeHint } from '../importTypes';

const hint = (h: Partial<ExtractedTimeHint>): ExtractedTimeHint => ({
  kind: 'none', dayOffset: null, weekday: null, month: null, dayOfMonth: null,
  timeHhmm: null, timePeriod: null, recurringWeekdays: [], ...h,
});

// Wednesday 4 Nov 2026, 12:00 Israel time (UTC+2) = 10:00Z. Weekday 3 = Wednesday (0 = Sunday).
const WED_NOON = new Date('2026-11-04T10:00:00Z');
const at = (h: Partial<ExtractedTimeHint>, now = WED_NOON, messageAt = WED_NOON) =>
  resolveTimeHint(hint(h), { messageAt, now });

describe('resolveTimeHint', () => {
  it('resolves "tomorrow at 8" against the message timestamp (FR-IMPORT-005 AC1)', () => {
    const r = at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '08:00' });
    expect(r.at?.toISOString()).toBe('2026-11-05T06:00:00.000Z');
    expect(r.dateIso).toBe('2026-11-05');
    expect(r.dropped).toBeNull();
  });

  it('resolves a weekday to the coming occurrence, never to today when no time is given', () => {
    expect(at({ kind: 'weekday', weekday: 4 }).dateIso).toBe('2026-11-05'); // Thursday
    expect(at({ kind: 'weekday', weekday: 3 }).dateIso).toBe('2026-11-11'); // next Wednesday
    expect(at({ kind: 'weekday', weekday: 6 }).dateIso).toBe('2026-11-07'); // Saturday
  });

  it('lets a weekday mean today only for an unambiguous time that is still ahead', () => {
    expect(at({ kind: 'weekday', weekday: 3, timeHhmm: '18:00' }).dateIso).toBe('2026-11-04');
    expect(at({ kind: 'weekday', weekday: 3, timeHhmm: '11:00' }).dateIso).toBe('2026-11-11'); // behind
    expect(at({ kind: 'weekday', weekday: 3, timeHhmm: '09:00' }).dateIso).toBe('2026-11-11'); // ambiguous hour
  });

  it('resolves an explicit date and wraps the year only across new year', () => {
    expect(at({ kind: 'date', month: 12, dayOfMonth: 5, timeHhmm: '10:00' }).dateIso).toBe('2026-12-05');
    const dec = new Date('2026-12-20T10:00:00Z');
    expect(at({ kind: 'date', month: 1, dayOfMonth: 3 }, dec, dec).dateIso).toBe('2027-01-03');
  });

  it('drops an impossible date and a past explicit date', () => {
    expect(at({ kind: 'date', month: 2, dayOfMonth: 31 }).dropped).toBe('invalid');
    expect(at({ kind: 'date', month: 10, dayOfMonth: 1 }).dropped).toBe('past');
  });

  it('drops a departure already in the past instead of moving it to next week (AC2)', () => {
    const r = at({ kind: 'relative_day', dayOffset: 0, timeHhmm: '08:00', timePeriod: 'morning' });
    expect(r.at).toBeNull();
    expect(r.dropped).toBe('past');
  });

  it('drops a stale forwarded message whose "tomorrow" is already behind us', () => {
    const old = new Date('2026-10-30T10:00:00Z');
    const r = at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '08:00' }, WED_NOON, old);
    expect(r.dropped).toBe('past');
  });

  it('returns a date without an instant when no time was written', () => {
    const r = at({ kind: 'relative_day', dayOffset: 2 });
    expect(r.at).toBeNull();
    expect(r.dateIso).toBe('2026-11-06');
  });

  it('resolves a recurring ride to the next occurrence and keeps the weekdays (D103)', () => {
    const r = at({ kind: 'recurring', recurringWeekdays: [0, 3], timeHhmm: '07:30' });
    expect(r.recurringWeekdays).toEqual([0, 3]);
    expect(r.dateIso).toBe('2026-11-08'); // Wed 07:30 already passed, next is Sunday
    expect(r.at?.toISOString()).toBe('2026-11-08T05:30:00.000Z');
  });

  it('computes the correct UTC instant across the October DST end (UTC+3 → UTC+2)', () => {
    const fri = new Date('2026-10-23T09:00:00Z');
    const sat = at({ kind: 'weekday', weekday: 6, timeHhmm: '08:00' }, fri, fri); // Sat 24 Oct, summer time
    expect(sat.at?.toISOString()).toBe('2026-10-24T05:00:00.000Z');
    const sun = at({ kind: 'weekday', weekday: 0, timeHhmm: '08:00' }, fri, fri); // Sun 25 Oct, clocks went back
    expect(sun.at?.toISOString()).toBe('2026-10-25T06:00:00.000Z');
  });

  describe('bare hours (AC3)', () => {
    it('keeps 24-hour values and uses the period words', () => {
      expect(at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '17:00' }).at?.toISOString()).toBe('2026-11-05T15:00:00.000Z');
      expect(at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '08:00', timePeriod: 'evening' }).at?.toISOString()).toBe('2026-11-05T18:00:00.000Z');
      expect(at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '11:00', timePeriod: 'night' }).at?.toISOString()).toBe('2026-11-05T21:00:00.000Z');
      expect(at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '02:00', timePeriod: 'night' }).at?.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    });

    it('marks a period-less ambiguous hour and picks a plausible default', () => {
      const morning = at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '08:00' });
      expect(morning.ambiguousHour).toBe(true);
      expect(morning.at?.toISOString()).toBe('2026-11-05T06:00:00.000Z');
      const afternoon = at({ kind: 'relative_day', dayOffset: 1, timeHhmm: '05:00' });
      expect(afternoon.at?.toISOString()).toBe('2026-11-05T15:00:00.000Z'); // 17:00
    });

    it('on the same day prefers the candidate that is still ahead of the message', () => {
      // 14:00 Israel; "today at 5" must be 17:00, since 05:00 is behind.
      const m = new Date('2026-11-04T12:00:00Z');
      const r = at({ kind: 'relative_day', dayOffset: 0, timeHhmm: '05:00' }, m, m);
      expect(r.at?.toISOString()).toBe('2026-11-04T15:00:00.000Z');
    });
  });

  it('returns nothing for kind none', () => {
    expect(at({ kind: 'none' })).toMatchObject({ at: null, dateIso: null, dropped: null });
  });
});
