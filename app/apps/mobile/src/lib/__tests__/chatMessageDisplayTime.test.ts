import { describe, it, expect } from 'vitest';
import { formatMessageBubbleTime } from '../chatMessageDisplayTime';

describe('formatMessageBubbleTime', () => {
  const now = new Date('2026-05-15T14:30:00.000Z');

  it('returns time-only when the message was sent on the same calendar day', () => {
    // 2 hours earlier on the same local date
    const isoSameDay = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const result = formatMessageBubbleTime(isoSameDay, now);

    expect(result).not.toContain('·');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns date and time separated by a middle dot for an earlier date', () => {
    // 3 days earlier
    const isoEarlier = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatMessageBubbleTime(isoEarlier, now);

    expect(result).toContain('·');
    const [datePart, timePart] = result.split('·').map((s) => s.trim());
    expect(datePart?.length).toBeGreaterThan(0);
    expect(timePart?.length).toBeGreaterThan(0);
  });

  it('returns date and time when the year differs', () => {
    const isoPreviousYear = '2025-05-15T10:00:00.000Z';
    const result = formatMessageBubbleTime(isoPreviousYear, now);

    expect(result).toContain('·');
  });

  it('defaults now to current date when now parameter is omitted', () => {
    const todayIso = new Date().toISOString();
    const result = formatMessageBubbleTime(todayIso);

    expect(result).not.toContain('·');
  });
});
