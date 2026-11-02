// @vitest-environment jsdom
// FR-RIDE-046 — "other dates" on an occurrence: one chip per upcoming date of the series, the
// current day marked, a tap opens another day's ride; nothing on a single ride.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const { push, listOccurrences } = vi.hoisted(() => ({ push: vi.fn(), listOccurrences: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../services/rideSeriesComposition', () => ({
  rideSeriesOccurrencesQueryKey: (id: string) => ['ride-series-occurrences', id],
  rideSeriesUseCases: { listOccurrences: () => ({ execute: listOccurrences }) },
}));
vi.mock('../../search/SearchChip', () => ({
  SearchChip: (p: { label: string; active: boolean; onPress: () => void }) => (
    <button data-testid={`chip:${p.label}`} data-active={String(p.active)} onClick={p.onPress} />
  ),
}));

import { RideSeriesOccurrences } from '../RideSeriesOccurrences';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MARKER = { ride_series: { id: 's1', on: '2026-11-02', weekdays: 0b11111, time: '07:30' } };

function renderDates(details: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <RideSeriesOccurrences listingId="l1" details={details} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RideSeriesOccurrences', () => {
  it('lists the series dates, marks the current one and opens another', async () => {
    listOccurrences.mockResolvedValue([
      { listingId: 'l1', departsAt: '2026-11-02T05:30:00Z', seatsLeft: 3, passengers: null },
      { listingId: 'l2', departsAt: '2026-11-03T05:30:00Z', seatsLeft: 0, passengers: null },
    ]);
    const view = renderDates(MARKER);
    await waitFor(() => expect(view.queryByTestId('ride-series-occurrences')).not.toBeNull());
    const chips = view.container.querySelectorAll('button');
    expect(chips).toHaveLength(2);
    expect(chips[0]!.getAttribute('data-active')).toBe('true');
    expect(chips[1]!.getAttribute('data-testid')).toContain('rideFeed.full');
    fireEvent.click(chips[0]!);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(chips[1]!);
    expect(push).toHaveBeenCalledWith({ pathname: '/listing/[listingId]', params: { listingId: 'l2' } });
    expect(listOccurrences).toHaveBeenCalledWith('s1');
  });

  it('renders nothing on a single ride or when the series has one date left', async () => {
    const single = renderDates({ departs_at: '2026-11-02T05:30:00Z' });
    expect(single.queryByTestId('ride-series-occurrences')).toBeNull();
    expect(listOccurrences).not.toHaveBeenCalled();
    cleanup();
    listOccurrences.mockResolvedValue([{ listingId: 'l1', departsAt: '2026-11-02T05:30:00Z', seatsLeft: 3, passengers: null }]);
    const last = renderDates(MARKER);
    await waitFor(() => expect(listOccurrences).toHaveBeenCalled());
    expect(last.queryByTestId('ride-series-occurrences')).toBeNull();
  });
});
