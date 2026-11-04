// Date-only (YYYY-MM-DD) helpers for admin forms. Noon UTC keeps the calendar day stable in any timezone.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses `YYYY-MM-DD`; returns undefined for anything else (including impossible dates is not checked by Date, only NaN). */
export function parseIsoDate(value: string): Date | undefined {
  if (!ISO_DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
