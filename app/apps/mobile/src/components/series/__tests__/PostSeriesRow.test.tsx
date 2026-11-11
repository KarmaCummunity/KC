// @vitest-environment jsdom
// FR-POST-024 — one recurring event on the owner's screen: the buttons follow the series
// machine, ending and cancelling a date ask first, and each action goes through its use case.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { PostSeries } from '@kc/domain';

const { listOccurrences, setStatus, cancelOccurrence, update } = vi.hoisted(() => ({
  listOccurrences: vi.fn(), setStatus: vi.fn(), cancelOccurrence: vi.fn(), update: vi.fn(),
}));

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
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
vi.mock('../../../services/postSeriesComposition', () => ({
  postSeriesOccurrencesQueryKey: (id: string) => ['post-series-occurrences', id],
  postSeriesUseCases: {
    listOccurrences: () => ({ execute: listOccurrences }),
    setStatus: () => ({ execute: setStatus }),
    cancelOccurrence: () => ({ execute: cancelOccurrence }),
    update: () => ({ execute: update }),
  },
}));
vi.mock('../PostSeriesScheduleEditor', () => ({ PostSeriesScheduleEditor: () => <div data-testid="editor" /> }));
vi.mock('../../cards/KcRowCard', () => ({
  KcRowCard: (p: { title: string; statusLabel: string | null; footer: React.ReactNode }) => (
    <div><span>{p.title}</span><span>{p.statusLabel}</span>{p.footer}</div>
  ),
}));

import { PostSeriesRow } from '../PostSeriesRow';

const SERIES: PostSeries = {
  id: 's1', title: 'Garden day', capacity: 12, timeZone: 'Asia/Jerusalem', status: 'active',
  schedule: { weekdays: [2], startTime: '17:00', durationMinutes: 120, endsOn: null },
};
const DATE = { postId: 'p1', occurrenceOn: '2026-11-17', startsAt: '2026-11-17T15:00:00Z' };

/** `run` as the screen provides it: it just runs the action. */
const run = vi.fn(async (action: () => Promise<unknown>) => { await action(); });

function mount(series: PostSeries = SERIES) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <PostSeriesRow series={series} busy={false} run={run} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PostSeriesRow', () => {
  it('pauses an active series and resumes a paused one', async () => {
    listOccurrences.mockResolvedValue([]);
    const active = mount();
    fireEvent.click(active.getByTestId('post-series-pause-s1'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('s1', 'paused'));
    cleanup();

    const paused = mount({ ...SERIES, status: 'paused' });
    expect(paused.queryByTestId('post-series-pause-s1')).toBeNull();
    fireEvent.click(paused.getByTestId('post-series-resume-s1'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('s1', 'active'));
  });

  it('ends the series only after the owner confirms', async () => {
    listOccurrences.mockResolvedValue([]);
    const view = mount();
    fireEvent.click(view.getByTestId('post-series-end-s1'));
    expect(setStatus).not.toHaveBeenCalled();
    expect(view.getByText('postSeries.endConfirm')).toBeTruthy();
    fireEvent.click(view.getByTestId('post-series-confirm-yes-s1'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('s1', 'ended'));
  });

  it('cancels one upcoming date after the owner confirms', async () => {
    listOccurrences.mockResolvedValue([DATE]);
    const view = mount();
    fireEvent.click(await view.findByTestId('post-series-cancel-date-p1'));
    expect(cancelOccurrence).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId('post-series-confirm-yes-s1'));
    await waitFor(() => expect(cancelOccurrence).toHaveBeenCalledWith('p1'));
  });
});
