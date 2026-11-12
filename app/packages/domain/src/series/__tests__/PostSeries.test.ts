import { describe, expect, it } from 'vitest';
import { postSeriesScheduleError, readPostSeriesMarker, type PostSeriesSchedule } from '../PostSeries';
import { postSeriesActions } from '../postSeriesActions';

const schedule = (over: Partial<PostSeriesSchedule> = {}): PostSeriesSchedule => ({
  weekdays: [2],
  startTime: '17:00',
  durationMinutes: 120,
  endsOn: null,
  ...over,
});

describe('postSeriesScheduleError', () => {
  it('accepts a weekly schedule, open-ended or ending today or later', () => {
    expect(postSeriesScheduleError(schedule(), '2026-11-11')).toBeNull();
    expect(postSeriesScheduleError(schedule({ endsOn: '2026-11-11' }), '2026-11-11')).toBeNull();
  });

  it('names the first problem: weekdays, time, length, end date', () => {
    expect(postSeriesScheduleError(schedule({ weekdays: [] }), '2026-11-11')).toBe('series_weekdays_required');
    expect(postSeriesScheduleError(schedule({ startTime: '25:00' }), '2026-11-11')).toBe('series_time_invalid');
    expect(postSeriesScheduleError(schedule({ durationMinutes: 10 }), '2026-11-11')).toBe('series_duration_invalid');
    expect(postSeriesScheduleError(schedule({ durationMinutes: 1441 }), '2026-11-11')).toBe('series_duration_invalid');
    expect(postSeriesScheduleError(schedule({ endsOn: '2026-11-10' }), '2026-11-11')).toBe('series_ends_in_past');
  });
});

describe('readPostSeriesMarker', () => {
  it('reads the series link of a date', () => {
    expect(readPostSeriesMarker({ series_id: 's1', series_on: '2026-11-17' })).toEqual({ id: 's1', on: '2026-11-17' });
  });

  it('is null on a single event and on a malformed link', () => {
    expect(readPostSeriesMarker({})).toBeNull();
    expect(readPostSeriesMarker({ series_id: 's1' })).toBeNull();
    expect(readPostSeriesMarker({ series_id: 's1', series_on: 'tomorrow' })).toBeNull();
  });
});

describe('postSeriesActions', () => {
  it('follows the series machine', () => {
    expect(postSeriesActions('active')).toEqual({ pause: true, resume: false, end: true });
    expect(postSeriesActions('paused')).toEqual({ pause: false, resume: true, end: true });
    expect(postSeriesActions('ended')).toEqual({ pause: false, resume: false, end: false });
    expect(postSeriesActions('archived')).toEqual({ pause: false, resume: false, end: false });
  });
});
