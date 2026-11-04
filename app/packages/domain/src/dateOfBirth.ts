// FR-AUTH-010 AC2.d — date of birth rules shared by the app and its tests.
// A date of birth is an ISO calendar date (`YYYY-MM-DD`), never a timestamp: it carries no
// time zone, so it cannot shift by a day between devices.

/** Members must be at least this old (the consent screen already asks for 18+, FR-AUTH-005 AC5.a). */
export const MIN_AGE_YEARS = 18;

/** The earliest date accepted; anything older is a typing mistake. Same bound as the database. */
export const EARLIEST_BIRTH_DATE = '1900-01-01';

export type DateOfBirthIssue = 'invalid_date_of_birth' | 'underage';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Builds `YYYY-MM-DD` from day / month / year, or null when it is not a real calendar date. */
export function composeIsoDate(day: number, month: number, year: number): string | null {
  if (![day, month, year].every(Number.isInteger)) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  if (!real || year < 1000 || year > 9999) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The `[year, month, day]` of an ISO date, or null when the text is not a real calendar date. */
export function parseIsoDate(iso: string): readonly [number, number, number] | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return composeIsoDate(day, month, year) === iso ? [year, month, day] : null;
}

/** Today as an ISO date in the device's local calendar. */
export function todayIso(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The latest birth date that is still at least `MIN_AGE_YEARS` old on `now`. */
export function latestAllowedBirthDate(now: Date): string {
  const [year, month, day] = parseIsoDate(todayIso(now))!;
  // 29 Feb has no counterpart 18 years earlier in a non-leap year: use 28 Feb (the member turns 18 a day early).
  const target = composeIsoDate(day, month, year - MIN_AGE_YEARS) ?? composeIsoDate(28, month, year - MIN_AGE_YEARS)!;
  return target;
}

/** Why a date of birth is not acceptable, or null when it is. ISO strings compare correctly as text. */
export function dateOfBirthIssue(iso: string, now: Date): DateOfBirthIssue | null {
  if (!parseIsoDate(iso) || iso < EARLIEST_BIRTH_DATE || iso > todayIso(now)) return 'invalid_date_of_birth';
  return iso > latestAllowedBirthDate(now) ? 'underage' : null;
}
