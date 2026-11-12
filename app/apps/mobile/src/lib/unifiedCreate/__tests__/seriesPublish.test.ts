import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/postSeriesComposition', () => ({ postSeriesUseCases: {} }));
vi.mock('../../../services/rideSeriesComposition', () => ({ rideSeriesUseCases: {} }));

import { eventDurationMinutes, eventSeriesInput, isEventSeriesDuration } from '../seriesPublish';

// Local wall-clock times, so the expected `HH:mm` does not depend on the machine's zone.
const STARTS = new Date(2026, 10, 17, 17, 0);
const ENDS = new Date(2026, 10, 17, 19, 30);
const SUBMITTED = {
  org_id: 'o1', registration_policy: 'automatic', capacity: 12, address: 'Community garden',
  starts_at: STARTS.toISOString(), ends_at: ENDS.toISOString(),
};

describe('eventSeriesInput (FR-POST-024)', () => {
  it('repeats the start time and the length, and keeps the times out of the template', () => {
    const input = eventSeriesInput(
      { kindId: 'k1', title: 'Garden day', summary: '  ', submitted: SUBMITTED, draft: { weekdays: [2], endsOn: new Date(2026, 11, 31) } },
      'tel-aviv', 'Asia/Jerusalem',
    );
    expect(input).toEqual({
      kindId: 'k1', title: 'Garden day', summary: null, cityId: 'tel-aviv', timeZone: 'Asia/Jerusalem', orgId: 'o1',
      details: { registration_policy: 'automatic', capacity: 12, address: 'Community garden' },
      schedule: { weekdays: [2], startTime: '17:00', durationMinutes: 150, endsOn: '2026-12-31' },
    });
  });

  it('measures one date and accepts 15 minutes to 24 hours', () => {
    expect(eventDurationMinutes(SUBMITTED)).toBe(150);
    expect(isEventSeriesDuration(SUBMITTED)).toBe(true);
    expect(isEventSeriesDuration({ ...SUBMITTED, ends_at: new Date(2026, 10, 20, 17, 0).toISOString() })).toBe(false);
    expect(isEventSeriesDuration({ starts_at: 'x' })).toBe(false);
  });
});
