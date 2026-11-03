// @vitest-environment jsdom
// G48 / D74 — following a route from the hub search (offers or requests, days, hours) and the
// "my routes" list with removal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { RidePlace, RideSavedRoute } from '@kc/domain';

const { save, listMine, remove } = vi.hoisted(() => ({ save: vi.fn(), listMine: vi.fn(), remove: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: { userId: 'u1' } }),
}));
vi.mock('../../../services/rideSavedRoutesComposition', () => ({
  MY_RIDE_ROUTES_QUERY_KEY: ['ride-saved-routes'],
  rideSavedRoutesUseCases: {
    save: () => ({ execute: save }),
    listMine: () => ({ execute: listMine }),
    remove: () => ({ execute: remove }),
  },
}));
vi.mock('../../search/SearchChip', () => ({
  SearchChip: (p: { label: string; onPress: () => void }) => <button data-testid={`chip:${p.label}`} onClick={p.onPress} />,
}));

import { RideRouteFollow } from '../RideRouteFollow';
import { SavedRideRoutesList } from '../SavedRideRoutesList';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };
const HAIFA: RidePlace = { kind: 'city', id: '4000', label: 'Haifa', lat: 32.82, lng: 35.0, cityId: '4000' };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RideRouteFollow', () => {
  it('saves the route with the chosen direction, days and hours', async () => {
    save.mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const view = wrap(<RideRouteFollow origin={TLV} dest={HAIFA} />);

    fireEvent.click(view.getByTestId('ride-route-follow'));
    fireEvent.click(view.getByTestId('chip:rideRoutes.wants.requests'));
    fireEvent.click(view.getByTestId('chip:rideRoutes.weekday.0'));
    fireEvent.click(view.getByTestId('chip:rideRoutes.weekday.4'));
    fireEvent.click(view.getByTestId('chip:rideRoutes.window.morning'));
    fireEvent.click(view.getByTestId('ride-route-follow-save'));

    await waitFor(() => expect(save).toHaveBeenCalledWith({
      wants: 'requests', origin: TLV, dest: HAIFA, weekdays: [0, 4], timeWindow: 'morning',
    }));
  });

  it('shows the server reason when saving fails', async () => {
    save.mockRejectedValue(new Error('saved_routes_limit'));
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const view = wrap(<RideRouteFollow origin={TLV} dest={HAIFA} />);
    fireEvent.click(view.getByTestId('ride-route-follow'));
    fireEvent.click(view.getByTestId('ride-route-follow-save'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('marketplace.errors.saved_routes_limit'));
  });
});

describe('SavedRideRoutesList', () => {
  const ROUTE: RideSavedRoute = { id: 'r1', wants: 'offers', origin: TLV, dest: HAIFA, weekdays: [0], timeWindow: null };

  it('lists my routes and removes one', async () => {
    listMine.mockResolvedValue([ROUTE]);
    remove.mockResolvedValue(undefined);
    const view = wrap(<SavedRideRoutesList />);
    await waitFor(() => expect(view.getByTestId('saved-ride-routes').textContent).toContain('Tel Aviv → Haifa'));
    fireEvent.click(view.getByTestId('saved-ride-route-remove-r1'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r1'));
  });

  it('renders nothing without routes', async () => {
    listMine.mockResolvedValue([]);
    const view = wrap(<SavedRideRoutesList />);
    await waitFor(() => expect(listMine).toHaveBeenCalled());
    expect(view.queryByTestId('saved-ride-routes')).toBeNull();
  });
});
