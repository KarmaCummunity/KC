import { describe, expect, it } from 'vitest';
import { maskToWeekdays, timeWindowFor, weekdaysToMask } from '../RideSavedRoute';

describe('weekday mask', () => {
  it('round-trips chosen weekdays', () => {
    expect(weekdaysToMask([0, 4])).toBe(0b10001);
    expect(maskToWeekdays(0b10001)).toEqual([0, 4]);
  });

  it('treats none, all seven and invalid days as every day', () => {
    expect(weekdaysToMask([])).toBeNull();
    expect(weekdaysToMask([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    expect(weekdaysToMask([7, -1])).toBeNull();
    expect(maskToWeekdays(null)).toBeNull();
    expect(maskToWeekdays(127)).toBeNull();
  });
});

describe('timeWindowFor', () => {
  it('names stored hours, including the seconds the server adds', () => {
    expect(timeWindowFor('06:00:00', '10:00:00')).toBe('morning');
    expect(timeWindowFor(null, null)).toBeNull();
    expect(timeWindowFor('07:00', '08:00')).toBeNull();
  });
});
