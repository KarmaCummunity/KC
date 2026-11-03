// FR-RIDE-046 — the copy of a recurring ride's schedule.
import { describe, expect, it } from 'vitest';
import { rideSeriesLabel, rideSeriesUntilLabel, rideWeekdaysLabel } from '../rideSeriesLabel';

const NAMES: Record<string, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
const t = (key: string, options?: Record<string, unknown>) => {
  const day = key.match(/^rideRoutes\.weekday\.(\d)$/);
  if (day) return NAMES[day[1]!]!;
  return `${key}:${Object.values(options ?? {}).join('|')}`;
};

describe('rideWeekdaysLabel', () => {
  it('collapses runs of three or more days and lists the rest', () => {
    expect(rideWeekdaysLabel([0, 1, 2, 3, 4], t)).toBe('Sun–Thu');
    expect(rideWeekdaysLabel([0, 2, 4], t)).toBe('Sun, Tue, Thu');
    expect(rideWeekdaysLabel([0, 1, 3, 4, 5], t)).toBe('Sun, Mon, Wed–Fri');
    expect(rideWeekdaysLabel([6], t)).toBe('Sat');
  });
});

describe('rideSeriesLabel', () => {
  it('names the days and the time, or every day', () => {
    expect(rideSeriesLabel({ weekdays: [0, 1, 2, 3, 4], time: '07:30' }, t)).toBe('rideSeries.every:Sun–Thu|07:30');
    expect(rideSeriesLabel({ weekdays: [0, 1, 2, 3, 4, 5, 6], time: '18:00' }, t)).toBe('rideSeries.everyDay:18:00');
  });

  it('names the end date when there is one', () => {
    expect(rideSeriesUntilLabel('2026-12-31', t)).toBe('rideSeries.until:31/12');
    expect(rideSeriesUntilLabel(null, t)).toBeNull();
    expect(rideSeriesUntilLabel('someday', t)).toBeNull();
  });
});
