// @vitest-environment jsdom
// G49 / D75 / S46 — ride quick publish: departure shortcuts, the estimated end suggested from the
// route until the driver edits it, and seats (default 3, 1–8).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { readRideRoute, suggestRideArrival, withRidePlace, type RidePlace } from '@kc/domain';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.0853, lng: 34.7818, cityId: '5000' };
const JLM: RidePlace = { kind: 'city', id: '3000', label: 'Jerusalem', lat: 31.7683, lng: 35.2137, cityId: '3000' };

// The native switch does not fire `onValueChange` from a DOM click; a button stands in for it.
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  const Switch = (p: { testID: string; value: boolean; onValueChange: (on: boolean) => void }) => (
    <button data-testid={p.testID} data-on={String(p.value)} onClick={() => p.onValueChange(!p.value)} />
  );
  return { ...actual, Switch };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
// The real field opens native pickers; here each field shows its shortcuts and one "pick" button.
vi.mock('../../ui/DateTimeField', () => ({
  DateTimeField: (p: { testID: string; onChange: (d: Date) => void; shortcuts?: { key: string; at: () => Date }[] }) => (
    <div>
      {p.shortcuts?.map((s) => <button key={s.key} data-testid={`${p.testID}-${s.key}`} onClick={() => p.onChange(s.at())} />)}
      <button data-testid={`${p.testID}-pick`} onClick={() => p.onChange(new Date('2026-12-01T12:00:00Z'))} />
    </div>
  ),
}));

import { RideScheduleFields } from '../RideScheduleFields';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ initial, withSeats = true }: { initial: Record<string, unknown>; withSeats?: boolean }) {
  const [details, setDetails] = useState(initial);
  const [leaveNow, setLeaveNow] = useState(false);
  return (
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RideScheduleFields details={details} onChange={setDetails} withSeats={withSeats} leaveNow={leaveNow} onLeaveNowChange={setLeaveNow} />
      <output data-testid="details">{JSON.stringify(details)}</output>
      <output data-testid="leave-now">{String(leaveNow)}</output>
    </ThemeProvider>
  );
}

const read = (view: ReturnType<typeof render>) => JSON.parse(view.getByTestId('details').textContent ?? '{}');
const route = withRidePlace(withRidePlace({}, 'origin', TLV), 'dest', JLM);

describe('RideScheduleFields', () => {
  it('starts an offer at 3 seats and keeps seats within 1–8', () => {
    const view = render(<Harness initial={{ seats_available: 8 }} />);
    fireEvent.click(view.getByLabelText('rideSchedule.moreSeats'));
    expect(read(view).seats_available).toBe(8);
    fireEvent.click(view.getByLabelText('rideSchedule.fewerSeats'));
    expect(read(view).seats_available).toBe(7);

    cleanup();
    expect(read(render(<Harness initial={{}} />)).seats_available).toBe(3);
  });

  it('has no seats for a ride request', () => {
    const view = render(<Harness initial={{}} withSeats={false} />);
    expect(read(view)).not.toHaveProperty('seats_available');
    expect(view.queryByTestId('ride-seats')).toBeNull();
  });

  it('sets the departure from a shortcut and suggests the estimated end from the route', () => {
    const view = render(<Harness initial={route} />);
    fireEvent.click(view.getByTestId('ride-departs-at-in60'));
    const { departs_at: departs, arrives_at: arrives } = read(view);
    // The suggestion is the route estimate (~54 km at 60 km/h + 15 min) rounded up to a quarter
    // hour, so it depends on the clock; compare with the domain rule instead of a fixed minute count.
    expect(arrives).toBe(suggestRideArrival(new Date(departs), readRideRoute(route))?.toISOString());
    expect(new Date(arrives).getTime() - new Date(departs).getTime()).toBeGreaterThan(60 * 60_000);
  });

  it('stops re-suggesting once the driver picks the estimated end', () => {
    const view = render(<Harness initial={route} />);
    fireEvent.click(view.getByTestId('ride-departs-at-in30'));
    fireEvent.click(view.getByTestId('ride-arrives-at-pick'));
    fireEvent.click(view.getByTestId('ride-departs-at-in60'));
    expect(read(view).arrives_at).toBe('2026-12-01T12:00:00.000Z');
  });

  describe('leave now (#1411)', () => {
    it('sets the departure a few minutes ahead and suggests the end from the route', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-04T20:00:00Z'));
      const view = render(<Harness initial={route} />);

      fireEvent.click(view.getByTestId('ride-leave-now'));

      const { departs_at: departs, arrives_at: arrives } = read(view);
      expect(departs).toBe('2026-11-04T20:05:00.000Z');
      expect(arrives).toBe(suggestRideArrival(new Date(departs), readRideRoute(route))?.toISOString());
      expect(view.getByTestId('leave-now').textContent).toBe('true');
    });

    it.each(['ride-departs-at-in60', 'ride-departs-at-pick'])('turns off when the member picks the time with %s', (testId) => {
      const view = render(<Harness initial={route} />);
      fireEvent.click(view.getByTestId('ride-leave-now'));

      fireEvent.click(view.getByTestId(testId));

      expect(view.getByTestId('leave-now').textContent).toBe('false');
    });
  });
});
