// @vitest-environment jsdom
// G45 / D71 — the ride route form: origin and destination from the official catalog, up to
// three meeting points, and the listing city suggested from the origin (a junction's nearest city).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { readRideRoute, type RidePlace } from '@kc/domain';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' };
const RAMAT_GAN: RidePlace = { kind: 'city', id: '8600', label: 'רמת גן', lat: 32.07, lng: 34.82, cityId: '8600' };
const GLILOT: RidePlace = { kind: 'junction', id: '106', label: 'מחלף גלילות מערב', lat: 32.14, lng: 34.8, cityId: null };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../lib/haptics', () => ({ hapticLightTap: vi.fn() }));
vi.mock('../../../hooks/useRidePlaces', () => ({
  useRidePlaces: () => ({ data: [TLV, RAMAT_GAN, GLILOT], isLoading: false, error: null, refetch: vi.fn() }),
}));
// The real field opens a searchable modal; here each field is one button that picks a place.
vi.mock('../RidePlaceField', () => ({
  RidePlaceField: ({ label, onChange }: { label: string; onChange: (p: RidePlace) => void }) => (
    <button data-testid={`pick:${label}`} onClick={() => onChange(GLILOT)}>{label}</button>
  ),
}));

import { RideRouteFields } from '../RideRouteFields';

afterEach(cleanup);

function Harness({ onOriginCity }: { onOriginCity: (c: { id: string; name: string }) => void }) {
  const [details, setDetails] = useState<Record<string, unknown>>({});
  return (
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RideRouteFields details={details} onChange={setDetails} onOriginCity={onOriginCity} />
      <output data-testid="details">{JSON.stringify(details)}</output>
    </ThemeProvider>
  );
}

const detailsOf = (view: ReturnType<typeof render>) =>
  JSON.parse(view.getByTestId('details').textContent ?? '{}') as Record<string, unknown>;

describe('RideRouteFields', () => {
  it('writes a junction origin and suggests its nearest city as the listing city', () => {
    const onOriginCity = vi.fn();
    const view = render(<Harness onOriginCity={onOriginCity} />);

    fireEvent.click(view.getByTestId('pick:ridePlaces.fieldOrigin'));

    expect(readRideRoute(detailsOf(view)).origin).toEqual(GLILOT);
    expect(onOriginCity).toHaveBeenCalledWith({ id: '5000', name: 'תל אביב - יפו' });
  });

  it('adds meeting points one at a time up to three, and removes one', () => {
    const view = render(<Harness onOriginCity={vi.fn()} />);
    const add = () => fireEvent.click(view.getByTestId('ride-meeting-point-add'));

    add();
    fireEvent.click(view.getByTestId('pick:ridePlaces.meetingPointLabel'));
    expect(readRideRoute(detailsOf(view)).meetingPoints).toEqual([GLILOT]);

    // Picking the same place twice keeps one: duplicates are dropped by the domain helper.
    add();
    fireEvent.click(view.getAllByTestId('pick:ridePlaces.meetingPointLabel').at(-1)!);
    expect(readRideRoute(detailsOf(view)).meetingPoints).toHaveLength(1);

    fireEvent.click(view.getByTestId('ride-meeting-point-remove-0'));
    expect(detailsOf(view)).not.toHaveProperty('meeting_points');
  });

  it('hides "add" once three meeting points are set', () => {
    const three = { meeting_points: [TLV, RAMAT_GAN, GLILOT].map((p) => ({ kind: p.kind, id: p.id, label: p.label, lat: p.lat, lng: p.lng, city_id: p.cityId })) };
    const view = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <RideRouteFields details={three} onChange={vi.fn()} />
      </ThemeProvider>,
    );
    expect(view.queryByTestId('ride-meeting-point-add')).toBeNull();
    expect(view.queryByTestId('ride-meeting-point-remove-2')).not.toBeNull();
  });
});
