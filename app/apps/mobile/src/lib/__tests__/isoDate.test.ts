import { describe, expect, it } from 'vitest';
import { parseIsoDate, toIsoDate } from '../isoDate';

describe('isoDate', () => {
  it('round-trips a valid date at noon UTC', () => {
    const d = parseIsoDate('2026-03-05');
    expect(d?.toISOString()).toBe('2026-03-05T12:00:00.000Z');
    expect(toIsoDate(d as Date)).toBe('2026-03-05');
  });

  it.each(['', '2026-3-5', '05/03/2026', '2026-13-45', 'garbage'])('rejects "%s"', (v) => {
    expect(parseIsoDate(v)).toBeUndefined();
  });
});
