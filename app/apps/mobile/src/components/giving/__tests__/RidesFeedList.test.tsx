// @vitest-environment jsdom
// #1626 / G49 / D75 — the rides feed on the shared listing card: day groups in order, offers and
// requests together, header before and links after the rides, a tap opens the ride, and the
// empty states (publish a ride, clear the filters, retry a failed load).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceBrowseRow, RideFeedItem, RideFeedSection } from '@kc/domain';
import type { RidesHubFeedState } from '../../../hooks/useRidesHubFeed';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
    i18n: { language: 'he' },
  }),
}));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../../lib/haptics', () => ({ hapticLightTap: () => undefined }));
// Kit buttons animate through Reanimated, which does not run under Vitest; a plain button suffices.
vi.mock('../../ui/Buttons', () => {
  const Button = (p: { label: string; testID?: string; onPress: () => void }) => (
    <button data-testid={p.testID} onClick={p.onPress}>{p.label}</button>
  );
  return { PrimaryButton: Button, SecondaryButton: Button };
});
// The shared card is under test elsewhere; here it only shows what it was given.
vi.mock('../../cards/ListingCard', () => ({
  ListingCard: (p: { item: MarketplaceBrowseRow; extraDetails?: { text: string }[]; onPress: () => void }) => (
    <button data-testid={`card-${p.item.listingId}`} onClick={p.onPress}>
      {[p.item.worldSlug, p.item.direction, ...(p.extraDetails ?? []).map((d) => d.text)].join(' | ')}
    </button>
  ),
}));

import { RidesFeedList } from '../RidesFeedList';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ride = (id: string, direction: 'give' | 'request', extra: Partial<RideFeedItem> = {}): RideFeedItem => ({
  listingId: id, direction, title: id, departsAt: '2099-01-01T06:00:00Z', originLabel: 'Tel Aviv', destLabel: 'Haifa',
  meetingPoints: 0, seatsLeft: direction === 'give' ? 2 : null, passengers: direction === 'request' ? 1 : null,
  recurrence: null, seriesMore: 0, ...extra,
});

function feedState(sections: RideFeedSection[], extra: Partial<RidesHubFeedState> = {}): RidesHubFeedState {
  return {
    sections,
    direction: 'all',
    setDirection: vi.fn(),
    origin: null,
    setOrigin: vi.fn(),
    dest: null,
    setDest: vi.fn(),
    routeActive: false,
    clearRoute: vi.fn(),
    refined: false,
    clear: vi.fn(),
    isLoading: false,
    isError: false,
    isRefreshing: false,
    refresh: vi.fn(),
    ...extra,
  };
}

function renderFeed(feed: RidesHubFeedState) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RidesFeedList feed={feed} header={<div data-testid="hub-header" />} footer={<div data-testid="hub-footer" />} />
    </ThemeProvider>,
  );
}

const follows = (view: ReturnType<typeof renderFeed>, a: string, b: string) =>
  Boolean(view.getByTestId(a).compareDocumentPosition(view.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('RidesFeedList', () => {
  it('opens on the rides: header, then the rides, then the links', () => {
    const view = renderFeed(feedState([{ group: 'today', items: [ride('o1', 'give')] }]));
    expect(follows(view, 'hub-header', 'rides-feed-item-o1')).toBe(true);
    expect(follows(view, 'rides-feed-item-o1', 'hub-footer')).toBe(true);
  });

  it('renders every ride on the shared card, under its day heading, offers and requests together', () => {
    const view = renderFeed(
      feedState([
        { group: 'today', items: [ride('o1', 'give', { meetingPoints: 2 }), ride('r1', 'request')] },
        { group: 'later', items: [ride('o2', 'give', { seatsLeft: 0 })] },
      ]),
    );
    expect(view.queryByTestId('rides-feed-today')).not.toBeNull();
    expect(view.queryByTestId('rides-feed-tomorrow')).toBeNull();
    expect(follows(view, 'rides-feed-today', 'rides-feed-later')).toBe(true);
    expect(view.getByTestId('card-o1').textContent).toBe('rides | give | rideFeed.meetingPoints:2');
    expect(view.getByTestId('card-r1').textContent).toBe('rides | request');
    expect(view.getByTestId('card-o2').textContent).toContain('rideFeed.full');
  });

  it('opens the ride on tap', () => {
    const view = renderFeed(feedState([{ group: 'today', items: [ride('o3', 'give')] }]));
    fireEvent.click(view.getByTestId('card-o3'));
    expect(push).toHaveBeenCalledWith({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId: 'o3' } });
  });

  it('invites a first ride when nothing is upcoming', () => {
    const view = renderFeed(feedState([]));
    expect(view.container.textContent).toContain('rideFeed.empty');
    fireEvent.click(view.getByTestId('rides-feed-empty-create'));
    expect(push).toHaveBeenCalledWith('/(tabs)/create?category=rides');
    expect(view.queryByTestId('rides-feed-empty-clear')).toBeNull();
  });

  it('offers to clear the filters when they hide every ride', () => {
    const feed = feedState([], { refined: true });
    const view = renderFeed(feed);
    expect(view.container.textContent).toContain('donations.rides.empty');
    fireEvent.click(view.getByTestId('rides-feed-empty-clear'));
    expect(feed.clear).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the feed failed to load', () => {
    const feed = feedState([], { isError: true });
    const view = renderFeed(feed);
    fireEvent.click(view.getByTestId('rides-feed-retry'));
    expect(feed.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows no empty state while the feed is loading', () => {
    const view = renderFeed(feedState([], { isLoading: true }));
    expect(view.queryByTestId('rides-feed-empty-create')).toBeNull();
    expect(view.container.textContent).not.toContain('rideFeed.empty');
  });
});
