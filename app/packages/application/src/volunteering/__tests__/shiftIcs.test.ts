import { describe, expect, it } from 'vitest';
import { buildShiftIcs } from '../shiftIcs';

describe('buildShiftIcs', () => {
  it('writes one event with UTC times and CRLF line breaks', () => {
    const ics = buildShiftIcs({ shiftId: 's1', title: 'Pack boxes', startsAt: '2026-03-01T08:00:00.000Z', endsAt: '2026-03-01T10:30:00Z' });
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Karma Community//Volunteering//EN',
      'BEGIN:VEVENT',
      'UID:s1@karma-community',
      'DTSTAMP:20260301T080000Z',
      'DTSTART:20260301T080000Z',
      'DTEND:20260301T103000Z',
      'SUMMARY:Pack boxes',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('escapes the reserved characters of the title', () => {
    const ics = buildShiftIcs({ shiftId: 's2', title: 'A, B; C\nD', startsAt: '2026-03-01T08:00:00Z', endsAt: '2026-03-01T09:00:00Z' });
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\nD');
  });
});
