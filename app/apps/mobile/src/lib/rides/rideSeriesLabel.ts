// Copy of a recurring ride's schedule (FR-RIDE-046): "every Sun–Thu at 07:30", "every day at 18:00",
// "until 31/12". Weekday names come from the locale; runs of three or more days collapse to a range.
import { format } from 'date-fns';
import { rideWeekdayRuns, type RideWeekday } from '@kc/domain';

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Schedule {
  readonly weekdays: readonly RideWeekday[];
  readonly time: string;
}

/** "Sun–Thu", "Sun, Tue, Thu" or "Fri–Sun": the weekdays of a schedule, Sunday first. */
export function rideWeekdaysLabel(weekdays: readonly RideWeekday[], t: Translate): string {
  const name = (d: RideWeekday) => t(`rideRoutes.weekday.${d}`);
  return rideWeekdayRuns(weekdays)
    .map(([first, last]) => (last - first >= 2 ? `${name(first)}–${name(last)}` : [first, last].filter((d, i) => i === 0 || d !== first).map(name).join(', ')))
    .join(', ');
}

/** "Every Sun–Thu at 07:30" — or "every day" when all seven days are picked. */
export function rideSeriesLabel(schedule: Schedule, t: Translate): string {
  if (schedule.weekdays.length === 7) return t('rideSeries.everyDay', { time: schedule.time });
  return t('rideSeries.every', { days: rideWeekdaysLabel(schedule.weekdays, t), time: schedule.time });
}

/** "Until 31/12" for a series with an end date (ISO date in); null when open-ended. */
export function rideSeriesUntilLabel(endsOn: string | null, t: Translate): string | null {
  if (!endsOn) return null;
  const day = new Date(`${endsOn}T00:00`);
  return Number.isNaN(day.getTime()) ? null : t('rideSeries.until', { date: format(day, 'd/M') });
}
