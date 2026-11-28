// A calendar day as `YYYY-MM-DD`, read and written in local time. A UTC conversion would move the
// day by the time-zone offset (just after midnight in Israel the UTC day is still yesterday).
import { format } from 'date-fns/format';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → local midnight of that day; null for an empty or malformed value. */
export function localDayToDate(value: string): Date | null {
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The local calendar day of `date` as `YYYY-MM-DD`. */
export function dateToLocalDay(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
