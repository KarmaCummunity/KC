// #1626 — pure rules of the rides hub feed on the shared card (D75 order and groups kept).
import { describe, expect, it } from 'vitest';
import type { RideFeedItem, RideFeedSection } from '@kc/domain';
import {
  filterRideSections,
  rideFeedCardExtras,
  rideFeedCardRow,
  rideFeedGridSections,
  rideRouteMatchFeedItem,
} from '../ridesHubFeed';

const t = (key: string, options?: Record<string, unknown>) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;

const ride = (id: string, direction: 'give' | 'request', extra: Partial<RideFeedItem> = {}): RideFeedItem => ({
  listingId: id,
  direction,
  title: id,
  departsAt: '2026-11-05T06:00:00Z',
  originLabel: 'Lod',
  destLabel: 'Tel Aviv',
  meetingPoints: 0,
  seatsLeft: direction === 'give' ? 2 : null,
  passengers: direction === 'request' ? 1 : null,
  recurrence: null,
  seriesMore: 0,
  ...extra,
});

const sections: RideFeedSection[] = [
  { group: 'today', items: [ride('o1', 'give'), ride('r1', 'request')] },
  { group: 'later', items: [ride('o2', 'give')] },
];

describe('filterRideSections', () => {
  it('keeps every ride and group for "all"', () => {
    expect(filterRideSections(sections, 'all')).toEqual(sections);
  });

  it('keeps one direction, in order, and drops groups left empty', () => {
    expect(filterRideSections(sections, 'give')).toEqual([
      { group: 'today', items: [sections[0]!.items[0]] },
      { group: 'later', items: [sections[1]!.items[0]] },
    ]);
    expect(filterRideSections(sections, 'request')).toEqual([{ group: 'today', items: [sections[0]!.items[1]] }]);
  });
});

describe('rideFeedGridSections', () => {
  it('chunks each day group into rows of two cards', () => {
    const three: RideFeedSection[] = [{ group: 'today', items: [ride('a', 'give'), ride('b', 'give'), ride('c', 'give')] }];
    const grid = rideFeedGridSections(three);
    expect(grid).toHaveLength(1);
    expect(grid[0]!.data.map((row) => row.map((item) => item.listingId))).toEqual([['a', 'b'], ['c']]);
  });

  it('returns no sections for an empty feed and guards a bad column count', () => {
    expect(rideFeedGridSections([])).toEqual([]);
    expect(rideFeedGridSections(sections, 0)[0]!.data).toHaveLength(2);
  });
});

describe('rideFeedCardRow', () => {
  it('maps an offer to a rides-world card row with its route, departure and free seats', () => {
    const row = rideFeedCardRow(ride('o1', 'give', { seatsLeft: 3 }));
    expect(row).toMatchObject({ listingId: 'o1', worldSlug: 'rides', kindSlug: 'ride_offer', direction: 'give' });
    expect(row.ride).toEqual({ originLabel: 'Lod', destLabel: 'Tel Aviv', departsAt: '2026-11-05T06:00:00Z', seats: 3 });
  });

  it('shows passengers on a request and no seats line on a full offer', () => {
    expect(rideFeedCardRow(ride('r1', 'request', { passengers: 4 })).ride?.seats).toBe(4);
    expect(rideFeedCardRow(ride('r2', 'request', { passengers: null })).ride?.seats).toBe(1);
    expect(rideFeedCardRow(ride('o3', 'give', { seatsLeft: 0 })).ride?.seats).toBeNull();
  });
});

describe('rideFeedCardExtras', () => {
  it('has no extra line on a plain ride', () => {
    expect(rideFeedCardExtras(ride('o1', 'give'), t)).toEqual([]);
  });

  it('marks a full offer and counts pickup points', () => {
    const lines = rideFeedCardExtras(ride('o1', 'give', { seatsLeft: 0, meetingPoints: 2 }), t);
    expect(lines.map((line) => line.text)).toEqual(['rideFeed.full', 'rideFeed.meetingPoints:2']);
  });

  it('never marks a request as full', () => {
    expect(rideFeedCardExtras(ride('r1', 'request', { seatsLeft: 0 }), t)).toEqual([]);
  });

  it('names a recurring ride and the later dates folded into it (FR-RIDE-046)', () => {
    const recurrence = { id: 's1', on: '2026-11-05', weekdays: [0, 1, 2, 3, 4] as const, time: '06:00' };
    const lines = rideFeedCardExtras(ride('o9', 'give', { recurrence, seriesMore: 27 }), t);
    expect(lines.map((line) => line.icon)).toEqual(['repeat-outline', 'calendar-outline']);
    expect(lines[1]!.text).toBe('rideSeries.moreDates:27');
  });
});

describe('rideRouteMatchFeedItem', () => {
  it('turns a corridor match into an offer feed item', () => {
    expect(
      rideRouteMatchFeedItem({
        listing_id: 'm1',
        title: 'Lod → Tel Aviv',
        seats_left: 2,
        departs_at: '2026-11-05T06:00:00Z',
        origin_label: 'Lod',
        dest_label: null,
      }),
    ).toEqual({
      listingId: 'm1',
      direction: 'give',
      title: 'Lod → Tel Aviv',
      departsAt: '2026-11-05T06:00:00Z',
      originLabel: 'Lod',
      destLabel: null,
      meetingPoints: 0,
      seatsLeft: 2,
      passengers: null,
      recurrence: null,
      seriesMore: 0,
    });
  });
});
