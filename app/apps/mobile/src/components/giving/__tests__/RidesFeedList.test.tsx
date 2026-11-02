// @vitest-environment jsdom
// G49 / D75 — the rides feed: day groups in order, offers and requests together, free seats or
// passengers on each row, and a tap opens the ride.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { RideFeedItem, RideFeedSection } from '@kc/domain';

const { push, loadRidesFeed } = vi.hoisted(() => ({ push: vi.fn(), loadRidesFeed: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../services/ridesFeedComposition', () => ({ loadRidesFeed, RIDES_FEED_QUERY_KEY: ['rides-feed'] }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../cards/KcRowCard', () => ({
  KcRowCard: (p: { testID: string; title: string; meta: (string | null)[]; onPress: () => void }) => (
    <button data-testid={p.testID} onClick={p.onPress}>{[p.title, ...p.meta.filter(Boolean)].join(' | ')}</button>
  ),
}));

import { RidesFeedList } from '../RidesFeedList';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ride = (id: string, direction: 'give' | 'request', extra: Partial<RideFeedItem> = {}): RideFeedItem => ({
  listingId: id, direction, title: id, departsAt: '2026-11-02T06:00:00Z', originLabel: 'Tel Aviv', destLabel: 'Haifa',
  meetingPoints: 0, seatsLeft: direction === 'give' ? 2 : null, passengers: direction === 'request' ? 1 : null, recurrence: null, ...extra,
});

function renderFeed(sections: RideFeedSection[]) {
  loadRidesFeed.mockResolvedValue(sections);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <RidesFeedList header={<div data-testid="hub-header" />} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RidesFeedList', () => {
  it('shows each day group with its rides, offers and requests together', async () => {
    const view = renderFeed([
      { group: 'today', items: [ride('o1', 'give', { meetingPoints: 2 })] },
      { group: 'later', items: [ride('r1', 'request', { passengers: 3 })] },
    ]);
    await waitFor(() => expect(view.queryByTestId('rides-feed-today')).not.toBeNull());
    expect(view.queryByTestId('rides-feed-tomorrow')).toBeNull();
    expect(view.getByTestId('rides-feed-item-o1').textContent).toContain('Tel Aviv → Haifa');
    expect(view.getByTestId('rides-feed-item-o1').textContent).toContain('rideFeed.seatsLeft');
    expect(view.getByTestId('rides-feed-item-o1').textContent).toContain('rideFeed.meetingPoints');
    expect(view.getByTestId('rides-feed-item-r1').textContent).toContain('rideFeed.passengers');
  });

  it('names the recurrence of a recurring ride occurrence (FR-RIDE-046)', async () => {
    const recurrence = { id: 's1', on: '2026-11-02', weekdays: [0, 1, 2, 3, 4] as const, time: '06:00' };
    const view = renderFeed([{ group: 'today', items: [ride('o9', 'give', { recurrence })] }]);
    await waitFor(() => expect(view.getByTestId('rides-feed-item-o9').textContent).toContain('rideSeries.every'));
  });

  it('marks a full offer', async () => {
    const view = renderFeed([{ group: 'tomorrow', items: [ride('o2', 'give', { seatsLeft: 0 })] }]);
    await waitFor(() => expect(view.getByTestId('rides-feed-item-o2').textContent).toContain('rideFeed.full'));
  });

  it('opens the ride on tap', async () => {
    const view = renderFeed([{ group: 'today', items: [ride('o3', 'give')] }]);
    await waitFor(() => expect(view.queryByTestId('rides-feed-item-o3')).not.toBeNull());
    fireEvent.click(view.getByTestId('rides-feed-item-o3'));
    expect(push).toHaveBeenCalledWith({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId: 'o3' } });
  });

  it('shows the empty state when no ride is upcoming', async () => {
    const view = renderFeed([]);
    await waitFor(() => expect(view.container.textContent).toContain('rideFeed.empty'));
  });
});
