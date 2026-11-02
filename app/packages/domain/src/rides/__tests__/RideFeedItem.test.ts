import { describe, expect, it } from 'vitest';
import { groupRidesByDay, type RideFeedItem } from '../RideFeedItem';

const item = (id: string, departsAt: Date): RideFeedItem => ({
  listingId: id, direction: 'give', title: id, departsAt: departsAt.toISOString(),
  originLabel: 'A', destLabel: 'B', meetingPoints: 0, seatsLeft: 2, passengers: null, recurrence: null,
});

describe('groupRidesByDay', () => {
  const now = new Date(2026, 10, 1, 20, 0); // local time

  it('groups by local day and keeps the order inside each group', () => {
    const sections = groupRidesByDay([
      item('tonight', new Date(2026, 10, 1, 22, 30)),
      item('tomorrow-morning', new Date(2026, 10, 2, 7, 0)),
      item('tomorrow-night', new Date(2026, 10, 2, 23, 59)),
      item('next-week', new Date(2026, 10, 8, 9, 0)),
    ], now);
    expect(sections.map((s) => [s.group, s.items.map((i) => i.listingId)])).toEqual([
      ['today', ['tonight']],
      ['tomorrow', ['tomorrow-morning', 'tomorrow-night']],
      ['later', ['next-week']],
    ]);
  });

  it('drops rides that already left and omits empty groups', () => {
    const sections = groupRidesByDay([item('left', new Date(2026, 10, 1, 19, 0)), item('later', new Date(2026, 10, 5, 9, 0))], now);
    expect(sections).toEqual([{ group: 'later', items: [expect.objectContaining({ listingId: 'later' })] }]);
  });
});
