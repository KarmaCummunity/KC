// @vitest-environment jsdom
// G46 / D72 — the ride detail shows its places in driving order, each with "navigate", and the
// route on a map; a junction navigates by coordinates.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { withMeetingPoints, withRidePlace, type RidePlace } from '@kc/domain';

// Hoisted: the module mocks below run before the file body.
const { openURL, mapProps } = vi.hoisted(() => ({ openURL: vi.fn(() => Promise.resolve()), mapProps: vi.fn() }));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return { ...actual, Linking: { openURL }, Platform: { ...actual.Platform, OS: 'ios' } };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../cards/ListingCard', () => ({ formatRideTime: () => null }));
vi.mock('../../map/KcMap', () => ({
  KcMap: (props: unknown) => {
    mapProps(props);
    return null;
  },
}));

import { RideRouteCard } from '../RideRouteCard';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };
const GLILOT: RidePlace = { kind: 'junction', id: '106', label: 'Glilot West', lat: 32.14, lng: 34.8, cityId: null };
const HAIFA: RidePlace = { kind: 'city', id: '4000', label: 'Haifa', lat: 32.82, lng: 35.0, cityId: '4000' };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(details: Record<string, unknown>, houseNumbers?: { origin?: string; dest?: string }) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RideRouteCard details={details} direction="give" houseNumbers={houseNumbers} />
    </ThemeProvider>,
  );
}

const fullRoute = withMeetingPoints(withRidePlace(withRidePlace({}, 'origin', TLV), 'dest', HAIFA), [GLILOT]);

describe('RideRouteCard', () => {
  it('says when a recurring ride repeats (FR-RIDE-046)', () => {
    const view = renderCard({ ...fullRoute, ride_series: { id: 's1', on: '2026-11-02', weekdays: 0b11111, time: '07:30' } });
    expect(view.getByText('rideSeries.every')).toBeTruthy();
    cleanup();
    expect(renderCard(fullRoute).queryByText('rideSeries.every')).toBeNull();
  });

  it('shows no cost, even on a ride that carries an amount (rides are free for now)', () => {
    const view = renderCard({ ...fullRoute, reward_model: 'expense_share', cost_share_ils: 30 });
    expect(view.queryByText('cards.costShare')).toBeNull();
    expect(view.queryByText('cards.free')).toBeNull();
  });

  it('lists origin, meeting point and destination in driving order', () => {
    const view = renderCard(fullRoute);
    const roles = view.getAllByTestId(/^ride-stop-(origin|meeting|dest)$/).map((el) => el.getAttribute('data-testid'));
    expect(roles).toEqual(['ride-stop-origin', 'ride-stop-meeting', 'ride-stop-dest']);
    expect(view.getByTestId('ride-stop-meeting').textContent).toContain('Glilot West');
  });

  it('opens the chosen navigation app at the place', () => {
    const view = renderCard(fullRoute);
    fireEvent.click(view.getByTestId('ride-stop-navigate-meeting'));
    fireEvent.click(view.getByTestId('ride-navigate-waze'));
    expect(openURL).toHaveBeenCalledWith('https://waze.com/ul?ll=32.14,34.8&navigate=yes');
    expect(view.queryByTestId('ride-navigate-apple')).not.toBeNull();
  });

  describe('private house numbers (FR-RIDE-003 AC9)', () => {
    const DIZENGOFF: RidePlace = { kind: 'street', id: '5000:404', label: 'Dizengoff, Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };
    const streetRoute = withRidePlace(withRidePlace({}, 'origin', HAIFA), 'dest', DIZENGOFF);

    it('shows the full address and navigates to it when the viewer may see the number', () => {
      const view = renderCard(streetRoute, { dest: '50' });
      expect(view.getByTestId('ride-stop-dest').textContent).toContain('Dizengoff 50, Tel Aviv');
      expect(view.getByText('ridePlaces.houseNumberPrivateNote')).toBeTruthy();
      fireEvent.click(view.getByTestId('ride-stop-navigate-dest'));
      fireEvent.click(view.getByTestId('ride-navigate-waze'));
      expect(openURL).toHaveBeenCalledWith(`https://waze.com/ul?q=${encodeURIComponent('Dizengoff 50, Tel Aviv')}&navigate=yes`);
    });

    it('shows only the street to everyone else', () => {
      const view = renderCard(streetRoute);
      expect(view.getByTestId('ride-stop-dest').textContent).toContain('Dizengoff, Tel Aviv');
      expect(view.queryByText('ridePlaces.houseNumberPrivateNote')).toBeNull();
    });
  });

  it('draws the route through the meeting points', () => {
    renderCard(fullRoute);
    expect(mapProps).toHaveBeenCalledWith(expect.objectContaining({
      route: { originLat: 32.08, originLng: 34.78, destLat: 32.82, destLng: 35.0 },
      routeStops: [GLILOT],
      markRouteOrigin: true,
    }));
  });

  it('shows no map until both ends are known', () => {
    const view = renderCard(withRidePlace({}, 'origin', TLV));
    expect(view.queryByTestId('ride-route-map')).toBeNull();
    expect(mapProps).not.toHaveBeenCalled();
  });
});
