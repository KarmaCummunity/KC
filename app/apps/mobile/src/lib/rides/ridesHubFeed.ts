// Pure rules of the rides hub feed (#1626; docs/spec/05_giving_worlds.md §5.3 "Feed", D75):
// the offers / requests filter over the day groups, the 2-column grid rows, the shared
// listing-card row of a ride, the ride-only card lines, and a route match as a feed item.
import type { MarketplaceBrowseRow, RideFeedItem, RideFeedSection } from '@kc/domain';
import type { WorldFeedDirection } from '../worldFeed';
import { rideSeriesLabel } from './rideSeriesLabel';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Cards per grid row: the same 2-column grid as every other world feed. */
export const RIDES_FEED_COLUMNS = 2;

/** One day group of the grid: its rides chunked into rows of `RIDES_FEED_COLUMNS` cards. */
export interface RideFeedGridSection {
  readonly group: RideFeedSection['group'];
  readonly data: readonly (readonly RideFeedItem[])[];
}

/** A detail line under a card (icon + text); mirrors `ListingCardDetail`. */
export interface RideCardExtraLine {
  readonly icon: 'alert-circle-outline' | 'location-outline' | 'repeat-outline' | 'calendar-outline';
  readonly text: string;
}

/** Keeps the rides of one direction; day groups left empty are dropped, order is kept. */
export function filterRideSections(
  sections: readonly RideFeedSection[],
  direction: WorldFeedDirection,
): RideFeedSection[] {
  if (direction === 'all') return [...sections];
  return sections
    .map((section) => ({ group: section.group, items: section.items.filter((item) => item.direction === direction) }))
    .filter((section) => section.items.length > 0);
}

/** Splits each day group into grid rows, so a day heading spans the whole width. */
export function rideFeedGridSections(
  sections: readonly RideFeedSection[],
  columns: number = RIDES_FEED_COLUMNS,
): RideFeedGridSection[] {
  const size = Math.max(1, Math.floor(columns));
  return sections.map((section) => {
    const rows: RideFeedItem[][] = [];
    for (let i = 0; i < section.items.length; i += size) rows.push(section.items.slice(i, i + size));
    return { group: section.group, data: rows };
  });
}

/**
 * The shared listing-card row of a ride. The card's seats line shows free seats on an offer
 * and passengers on a request; a full offer has no seats line (its "full" line is an extra).
 */
export function rideFeedCardRow(item: RideFeedItem): MarketplaceBrowseRow {
  const seats = item.direction === 'give' ? (item.seatsLeft ? item.seatsLeft : null) : (item.passengers ?? 1);
  return {
    listingId: item.listingId,
    worldSlug: 'rides',
    kindSlug: item.direction === 'give' ? 'ride_offer' : 'ride_request',
    direction: item.direction,
    title: item.title,
    summary: null,
    urgencyLevel: 0,
    availabilityStatus: 'available',
    cityId: null,
    distanceKm: null,
    ride: { originLabel: item.originLabel, destLabel: item.destLabel, departsAt: item.departsAt, seats },
    publisher: null,
  };
}

/** Ride-only lines under the card: a full offer, pickup points, and a recurring ride's dates. */
export function rideFeedCardExtras(item: RideFeedItem, t: Translate): RideCardExtraLine[] {
  const lines: RideCardExtraLine[] = [];
  if (item.direction === 'give' && item.seatsLeft === 0) lines.push({ icon: 'alert-circle-outline', text: t('rideFeed.full') });
  if (item.meetingPoints > 0) {
    lines.push({ icon: 'location-outline', text: t('rideFeed.meetingPoints', { count: item.meetingPoints }) });
  }
  // A recurring ride says when it repeats; under "later" a series is one card that counts
  // the dates folded into it (FR-RIDE-046).
  if (item.recurrence) lines.push({ icon: 'repeat-outline', text: rideSeriesLabel(item.recurrence, t) });
  if (item.seriesMore > 0) lines.push({ icon: 'calendar-outline', text: t('rideSeries.moreDates', { count: item.seriesMore }) });
  return lines;
}
