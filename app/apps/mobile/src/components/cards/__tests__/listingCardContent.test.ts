// Listing card content (docs/spec/07 §7.4): a ride shows its departure and seats / passengers
// and its route; other listings (or a ride with nothing known) fall back to the secondary line.
import { describe, expect, it } from 'vitest';
import type { RideCardSummary } from '@kc/domain';
import { listingCardDetails, listingCardRoute } from '../listingCardContent';

const t = (key: string, options?: Record<string, unknown>) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;
const formatTime = (iso: string | null | undefined) => (iso ? `at ${iso}` : null);

const RIDE: RideCardSummary = { originLabel: 'Lod', destLabel: 'Tel Aviv', departsAt: '08:00', seats: 3 };

describe('listingCardDetails', () => {
  it('shows a ride offer departure and its free seats', () => {
    expect(listingCardDetails({ ride: RIDE, isRequest: false, secondary: 'ignored', t, formatTime })).toEqual([
      { icon: 'time-outline', text: 'at 08:00' },
      { icon: 'people-outline', text: 'cards.seats_other:3' },
    ]);
  });

  it('counts passengers on a ride request', () => {
    const details = listingCardDetails({ ride: { ...RIDE, departsAt: null }, isRequest: true, secondary: null, t, formatTime });
    expect(details).toEqual([{ icon: 'people-outline', text: 'cards.passengers_other:3' }]);
  });

  it('picks the singular copy for one seat or one passenger (#1412: v3 i18n does not resolve plurals)', () => {
    const one = { ...RIDE, departsAt: null, seats: 1 };
    expect(listingCardDetails({ ride: one, isRequest: false, secondary: null, t, formatTime })).toEqual([
      { icon: 'people-outline', text: 'cards.seats_one:1' },
    ]);
    expect(listingCardDetails({ ride: one, isRequest: true, secondary: null, t, formatTime })).toEqual([
      { icon: 'people-outline', text: 'cards.passengers_one:1' },
    ]);
  });

  it('falls back to the secondary line when the ride has nothing to show', () => {
    const empty = { ...RIDE, departsAt: null, seats: null };
    expect(listingCardDetails({ ride: empty, isRequest: false, secondary: 'Two bags', t, formatTime })).toEqual([
      { icon: 'information-circle-outline', text: 'Two bags' },
    ]);
  });

  it('shows the secondary line of a listing that is not a ride, and nothing without one', () => {
    expect(listingCardDetails({ ride: null, isRequest: false, secondary: 'Solid oak', t, formatTime })).toHaveLength(1);
    expect(listingCardDetails({ ride: null, isRequest: false, secondary: null, t, formatTime })).toEqual([]);
    expect(listingCardDetails({ ride: null, isRequest: false, secondary: '', t, formatTime })).toEqual([]);
  });
});

describe('listingCardRoute', () => {
  it('shows "from → to" when both ends are known', () => {
    expect(listingCardRoute(RIDE, t)).toEqual({ from: 'Lod', to: 'Tel Aviv' });
  });

  it('names an unknown end as an unknown place', () => {
    expect(listingCardRoute({ ...RIDE, destLabel: null }, t)).toEqual({ from: 'Lod', to: 'cards.unknownPlace' });
  });

  it('shows no route for a listing that is not a ride, or a ride with no known end', () => {
    expect(listingCardRoute(null, t)).toBeNull();
    expect(listingCardRoute({ ...RIDE, originLabel: null, destLabel: null }, t)).toBeNull();
  });
});
