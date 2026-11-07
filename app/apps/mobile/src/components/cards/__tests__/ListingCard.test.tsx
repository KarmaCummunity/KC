// @vitest-environment jsdom
// #1412 — a listing card (the "For you" row, the world hubs, the map) reads like the feed card of
// the same post (docs/spec/07 §7.4): the feed's direction badge, the world chip and the
// publisher's name. A ride keeps its route on top.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceBrowseRow } from '@kc/domain';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../ui/KCImage', () => ({ KCImage: () => null }));
vi.mock('../../AvatarInitials', () => ({ AvatarInitials: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
    i18n: { language: 'he' },
  }),
}));
vi.mock('../../../hooks/useShellContentWidth', () => ({ usePostGridCardWidth: () => 180 }));

import { enUS } from 'date-fns/locale/en-US';
import { formatRideTime, listingWorldIcon, ListingCard } from '../ListingCard';

afterEach(cleanup);

const RIDE_OFFER: MarketplaceBrowseRow = {
  listingId: 'ride-1',
  worldSlug: 'rides',
  kindSlug: 'ride_offer',
  direction: 'give',
  title: 'Ramla to Tel Aviv',
  summary: null,
  urgencyLevel: 0,
  availabilityStatus: 'open',
  cityId: null,
  distanceKm: null,
  ride: { originLabel: 'Ramla', destLabel: 'Tel Aviv', departsAt: null, seats: 3 },
  publisher: { displayName: 'Dana', avatarUrl: null },
};

function renderCard(item: MarketplaceBrowseRow) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ListingCard item={item} onPress={() => {}} />
    </ThemeProvider>,
  );
}

describe('ListingCard', () => {
  it('shows a ride offer with the feed badge, the rides chip and its publisher', () => {
    const { getByText, queryByText } = renderCard(RIDE_OFFER);
    expect(getByText('feed.giveTypeShort')).toBeTruthy();
    expect(queryByText('cards.rideOffer')).toBeNull();
    expect(getByText('post.unifiedCreate.categories.rides')).toBeTruthy();
    expect(getByText('Dana')).toBeTruthy();
    expect(getByText('Tel Aviv')).toBeTruthy();
  });

  it('badges a ride request as a request, like the feed', () => {
    const { getByText } = renderCard({ ...RIDE_OFFER, direction: 'request' });
    expect(getByText('feed.requestTypeShort')).toBeTruthy();
  });

  it('names a publisher without a display name as a community member', () => {
    const { getByText } = renderCard({ ...RIDE_OFFER, publisher: { displayName: null, avatarUrl: null } });
    expect(getByText('marketplace.anonymousOwner')).toBeTruthy();
  });

  it('shows no author row when the publisher is unknown', () => {
    const { queryByText } = renderCard({ ...RIDE_OFFER, publisher: null });
    expect(queryByText('Dana')).toBeNull();
    expect(queryByText('marketplace.anonymousOwner')).toBeNull();
  });

  it('keeps the marketplace world name for a world that is not a create category', () => {
    const { getByText } = renderCard({ ...RIDE_OFFER, worldSlug: 'environment', ride: null });
    expect(getByText('marketplace.world.environment')).toBeTruthy();
  });

  it('resolves correct icons for worlds including animals', () => {
    expect(listingWorldIcon('animals')).toBe('paw-outline');
    expect(listingWorldIcon('knowledge')).toBe('school-outline');
    expect(listingWorldIcon('rides')).toBe('car-outline');
  });

  it('formats ride time in English when English locale is provided', () => {
    const formatted = formatRideTime('2026-11-08T10:00:00Z', enUS);
    expect(formatted).toMatch(/Sunday|10:00/);
  });
});
