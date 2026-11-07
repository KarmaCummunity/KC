// @vitest-environment jsdom
// FR-RIDE-046 — "my recurring rides": each series with its schedule, pause / resume,
// cancel behind a confirm step, reschedule through the editor; the empty state.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../useWorldHeader', () => ({ WorldSubScreenChrome: () => null }));
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { withRidePlace, type RidePlace, type RideSeries } from '@kc/domain';

const { listMine, setStatus, updateSchedule } = vi.hoisted(() => ({ listMine: vi.fn(), setStatus: vi.fn(), updateSchedule: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length > 0 ? `${k}:${Object.values(o).join('|')}` : k),
    i18n: { language: 'he' },
  }),
}));
// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../ui/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../services/ridesFeedComposition', () => ({ RIDES_FEED_QUERY_KEY: ['rides-feed'] }));
vi.mock('../../../services/rideSeriesComposition', () => ({
  MY_RIDE_SERIES_QUERY_KEY: ['ride-series'],
  rideSeriesUseCases: {
    listMine: () => ({ execute: listMine }),
    setStatus: () => ({ execute: setStatus }),
    updateSchedule: () => ({ execute: updateSchedule }),
  },
}));
vi.mock('../../search/SearchChip', () => ({
  SearchChip: (p: { label: string; onPress: () => void }) => <button data-testid={`chip:${p.label}`} onClick={p.onPress} />,
}));
vi.mock('../../ui/DateTimeField', () => ({
  DateTimeField: (p: { testID: string; onChange: (d: Date) => void }) => (
    <button data-testid={`${p.testID}-pick`} onClick={() => p.onChange(new Date(2026, 10, 2, 8, 15))} />
  ),
}));
vi.mock('../../cards/KcRowCard', () => ({
  KcRowCard: (p: { testID: string; title: string; meta: (string | null)[]; statusLabel?: string | null; footer: React.ReactNode }) => (
    <div data-testid={p.testID}>
      <span data-testid={`${p.testID}-text`}>{[p.title, ...p.meta.filter(Boolean), p.statusLabel].filter(Boolean).join(' | ')}</span>
      {p.footer}
    </div>
  ),
}));

import { MyRideSeriesList } from '../MyRideSeriesList';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };
const JLM: RidePlace = { kind: 'city', id: '3000', label: 'Jerusalem', lat: 31.77, lng: 35.21, cityId: '3000' };
const SERIES: RideSeries = {
  id: 's1', direction: 'give', title: 'ride', details: withRidePlace(withRidePlace({}, 'origin', TLV), 'dest', JLM),
  schedule: { weekdays: [0, 1, 2, 3, 4], time: '07:30', endsOn: '2026-12-31' }, durationMinutes: 60, status: 'active',
};

// Success copy goes through `alert`, which jsdom does not implement.
vi.stubGlobal('alert', vi.fn());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderList(series: RideSeries[]) {
  listMine.mockResolvedValue(series);
  setStatus.mockResolvedValue(undefined);
  updateSchedule.mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <MyRideSeriesList />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('MyRideSeriesList', () => {
  it('shows each series with its route, schedule and end date', async () => {
    const view = renderList([SERIES, { ...SERIES, id: 's2', status: 'paused' }]);
    await waitFor(() => expect(view.queryByTestId('ride-series-row-s1')).not.toBeNull());
    const text = view.getByTestId('ride-series-row-s1-text').textContent ?? '';
    expect(text).toContain('Tel Aviv → Jerusalem');
    expect(text).toContain('rideSeries.every:');
    expect(text).toContain('rideSeries.until:31/12');
    expect(view.getByTestId('ride-series-row-s2-text').textContent).toContain('rideSeries.status.paused');
    expect(view.getByTestId('ride-series-resume-s2')).toBeTruthy();
  });

  it('pauses a series', async () => {
    const view = renderList([SERIES]);
    fireEvent.click(await view.findByTestId('ride-series-pause-s1'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('s1', 'paused'));
  });

  it('cancels only after the confirm step', async () => {
    const view = renderList([SERIES]);
    fireEvent.click(await view.findByTestId('ride-series-cancel-s1'));
    expect(setStatus).not.toHaveBeenCalled();
    expect(view.getByText('rideSeries.cancelConfirm')).toBeTruthy();
    fireEvent.click(view.getByTestId('ride-series-cancel-yes-s1'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('s1', 'cancelled'));
  });

  it('reschedules through the editor: a day toggled, a new time, the end date kept', async () => {
    const view = renderList([SERIES]);
    fireEvent.click(await view.findByTestId('ride-series-edit-s1'));
    fireEvent.click(view.getByTestId('chip:rideRoutes.weekday.4'));
    fireEvent.click(view.getByTestId('ride-series-time-pick'));
    fireEvent.click(view.getByTestId('ride-series-save-s1'));
    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith('s1', { weekdays: [0, 1, 2, 3], time: '08:15', endsOn: '2026-12-31' }, 60),
    );
  });

  it('shows the empty state', async () => {
    const view = renderList([]);
    await waitFor(() => expect(view.container.textContent).toContain('rideSeries.empty'));
  });
});
