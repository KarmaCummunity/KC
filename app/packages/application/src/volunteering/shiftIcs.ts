// The calendar file of a volunteering shift, built on the device from the event's start and end
// (the baseline keeps no calendar function): one VEVENT, UTC times, CRLF line breaks (RFC 5545).

export interface ShiftIcsInput {
  readonly shiftId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** `20260102T030405Z` of an ISO instant. */
function icsTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escapes the characters RFC 5545 reserves in a TEXT value. */
function icsText(text: string): string {
  // split/join, not a global regex (Sonar S7781) and not replaceAll (some packages that compile
  // this file target a lib before ES2021).
  const escaped = text.split('\\').join('\\\\').split(';').join('\\;').split(',').join('\\,');
  return escaped.replace(/\r?\n/g, '\\n');
}

/** The `.ics` document of a shift. */
export function buildShiftIcs(shift: ShiftIcsInput): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Karma Community//Volunteering//EN',
    'BEGIN:VEVENT',
    `UID:${shift.shiftId}@karma-community`,
    `DTSTAMP:${icsTime(shift.startsAt)}`,
    `DTSTART:${icsTime(shift.startsAt)}`,
    `DTEND:${icsTime(shift.endsAt)}`,
    `SUMMARY:${icsText(shift.title)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
