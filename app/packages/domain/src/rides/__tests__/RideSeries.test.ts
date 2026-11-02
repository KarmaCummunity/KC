// FR-RIDE-046 — recurring rides: weekday masks and runs, the schedule checks and the
// occurrence marker every screen reads.
import { describe, expect, it } from 'vitest';
import {
  localIsoDate,
  localTimeHHmm,
  readRideSeriesMarker,
  rideDurationMinutes,
  rideSeriesScheduleError,
  rideWeekdayRuns,
  rideWeekdaysFromMask,
  rideWeekdaysToMask,
} from '../RideSeries';

describe('ride series weekdays', () => {
  it('round-trips the server bit mask, Sunday first', () => {
    expect(rideWeekdaysToMask([0, 1, 2, 3, 4])).toBe(0b11111);
    expect(rideWeekdaysToMask([6, 0])).toBe(0b1000001);
    expect(rideWeekdaysToMask([])).toBe(0);
    expect(rideWeekdaysToMask([3, 3, 9, -1])).toBe(0b1000);
    expect(rideWeekdaysFromMask(0b1000001)).toEqual([0, 6]);
    expect(rideWeekdaysFromMask(127)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('groups consecutive days into runs for a compact label', () => {
    expect(rideWeekdayRuns([0, 1, 2, 3, 4])).toEqual([[0, 4]]);
    expect(rideWeekdayRuns([4, 2, 0])).toEqual([[0, 0], [2, 2], [4, 4]]);
    expect(rideWeekdayRuns([5, 6, 0, 1])).toEqual([[0, 1], [5, 6]]);
    expect(rideWeekdayRuns([])).toEqual([]);
  });
});

describe('ride series schedule', () => {
  const today = '2026-11-02';

  it('accepts weekdays, an HH:mm time and an end date from today on', () => {
    expect(rideSeriesScheduleError({ weekdays: [0, 4], time: '07:30', endsOn: null }, today)).toBeNull();
    expect(rideSeriesScheduleError({ weekdays: [0], time: '23:59', endsOn: today }, today)).toBeNull();
  });

  it('names the first problem', () => {
    expect(rideSeriesScheduleError({ weekdays: [], time: '07:30', endsOn: null }, today)).toBe('series_weekdays_required');
    expect(rideSeriesScheduleError({ weekdays: [0], time: '7:30', endsOn: null }, today)).toBe('series_time_invalid');
    expect(rideSeriesScheduleError({ weekdays: [0], time: '24:00', endsOn: null }, today)).toBe('series_time_invalid');
    expect(rideSeriesScheduleError({ weekdays: [0], time: '07:30', endsOn: '2026-11-01' }, today)).toBe('series_ends_in_past');
    expect(rideSeriesScheduleError({ weekdays: [0], time: '07:30', endsOn: 'soon' }, today)).toBe('series_ends_in_past');
  });

  it('formats local time and date, and measures a ride from its details', () => {
    const at = new Date(2026, 10, 2, 7, 5);
    expect(localTimeHHmm(at)).toBe('07:05');
    expect(localIsoDate(at)).toBe('2026-11-02');
    expect(rideDurationMinutes({ departs_at: '2026-11-02T05:00:00Z', arrives_at: '2026-11-02T06:15:00Z' })).toBe(75);
    expect(rideDurationMinutes({ departs_at: '2026-11-02T05:00:00Z' })).toBeNull();
    expect(rideDurationMinutes({ departs_at: '2026-11-02T05:00:00Z', arrives_at: '2026-11-02T05:00:00Z' })).toBeNull();
  });
});

describe('readRideSeriesMarker', () => {
  it('reads the marker of an occurrence', () => {
    expect(readRideSeriesMarker({ ride_series: { id: 's1', on: '2026-11-03', weekdays: 0b11111, time: '07:30' } }))
      .toEqual({ id: 's1', on: '2026-11-03', weekdays: [0, 1, 2, 3, 4], time: '07:30' });
  });

  it('is null on a single ride or a malformed marker', () => {
    expect(readRideSeriesMarker({ departs_at: '2026-11-03T05:30:00Z' })).toBeNull();
    expect(readRideSeriesMarker({ ride_series: 's1' })).toBeNull();
    expect(readRideSeriesMarker({ ride_series: { id: 's1', on: '2026-11-03', weekdays: 0, time: '07:30' } })).toBeNull();
    expect(readRideSeriesMarker({ ride_series: { id: 's1', on: '2026-11-03', weekdays: 3, time: '7h30' } })).toBeNull();
  });
});
