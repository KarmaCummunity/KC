// @vitest-environment jsdom
// #1626 — the rides hub filters around the feed: the route search is a collapsed filter on top
// (naming the chosen route, with "clear").
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { RidePlace } from '@kc/domain';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { from?: string; to?: string }) =>
      options?.from ? `${key}:${options.from}>${options.to}` : key,
    i18n: { language: 'he' },
  }),
}));
vi.mock('../../ui/Buttons', () => ({
  GhostButton: (p: { label: string; testID?: string; onPress: () => void }) => (
    <button data-testid={p.testID} onClick={p.onPress}>{p.label}</button>
  ),
}));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticLightTap: () => undefined }));
vi.mock('../../../hooks/useRidePlaces', () => ({
  useRidePlaces: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (state: { session: { userId: string } }) => unknown) => select({ session: { userId: 'u1' } }),
}));
vi.mock('../RidePlaceField', () => ({ RidePlaceField: (p: { label: string }) => <div data-testid={`place-${p.label}`} /> }));
vi.mock('../RideRouteFollow', () => ({ RideRouteFollow: () => <div data-testid="route-follow" /> }));
vi.mock('../SavedRideRoutesList', () => ({ SavedRideRoutesList: () => null }));

import { RideRouteFilter } from '../RideRouteFilter';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

const place = (id: string): RidePlace => ({ kind: 'city', id, label: id, lat: 32, lng: 34.9, cityId: id });

function filterState(extra: Partial<Parameters<typeof RideRouteFilter>[0]['filter']> = {}) {
  return {
    origin: null,
    setOrigin: vi.fn(),
    dest: null,
    setDest: vi.fn(),
    routeActive: false,
    clearRoute: vi.fn(),
    ...extra,
  };
}

describe('RideRouteFilter', () => {
  it('starts collapsed and opens the route fields on tap', () => {
    const view = withTheme(<RideRouteFilter filter={filterState()} />);
    expect(view.getByTestId('rides-route-filter-toggle').textContent).toBe('rideFeed.routeFilterTitle');
    expect(view.queryByTestId('rides-route-filter-panel')).toBeNull();
    expect(view.queryByTestId('rides-route-filter-clear')).toBeNull();

    fireEvent.click(view.getByTestId('rides-route-filter-toggle'));
    expect(view.getByTestId('place-ridePlaces.fieldOrigin')).toBeTruthy();
    expect(view.getByTestId('place-ridePlaces.fieldDest')).toBeTruthy();
  });

  it('names the chosen route even when collapsed, and clears it', () => {
    const filter = filterState({ origin: place('Lod'), dest: place('Haifa'), routeActive: true });
    const view = withTheme(<RideRouteFilter filter={filter} />);
    expect(view.getByTestId('rides-route-filter-toggle').textContent).toBe('rideFeed.routeFilterActive:Lod>Haifa');
    fireEvent.click(view.getByTestId('rides-route-filter-clear'));
    expect(filter.clearRoute).toHaveBeenCalledTimes(1);
  });
});
