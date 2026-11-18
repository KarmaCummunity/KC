// FR-RESP-006 AC31 — an admin day is picked and kept as the local calendar day, never shifted by UTC.
import { describe, expect, it } from 'vitest';
import { dateToLocalDay, localDayToDate } from '../localDay';

describe('admin day <-> date', () => {
  it('reads a day as its local midnight', () => {
    const date = localDayToDate('2026-03-09');
    expect(date).not.toBeNull();
    expect([date!.getFullYear(), date!.getMonth(), date!.getDate(), date!.getHours()]).toEqual([2026, 2, 9, 0]);
  });

  it('writes the local day, even just after midnight (where a UTC day would still be yesterday east of Greenwich)', () => {
    expect(dateToLocalDay(new Date(2026, 2, 9, 0, 5))).toBe('2026-03-09');
    expect(dateToLocalDay(new Date(2026, 2, 9, 23, 55))).toBe('2026-03-09');
  });

  it('round-trips and rejects an empty or malformed value', () => {
    expect(dateToLocalDay(localDayToDate('2026-12-31')!)).toBe('2026-12-31');
    expect(localDayToDate('')).toBeNull();
    expect(localDayToDate('31/12/2026')).toBeNull();
  });
});
