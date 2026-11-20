// @vitest-environment jsdom
// FR-KNOW-003 AC2 / FR-KNOW-004 AC1 (#2479) — a weekly lesson shows its schedule to everyone; the
// giver also sees whether it runs and pauses, resumes or ends it (ending asks first).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { KnowledgeSlotSeries } from '@kc/domain';

const getSeries = vi.fn();
const setStatus = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'he' },
  }),
}));
vi.mock('../../../services/knowledgeBookingComposition', () => ({
  knowledgeSlotsQueryKey: (id: string) => ['knowledge-slots', id],
  knowledgeBookingsQueryKey: (id: string) => ['knowledge-bookings', id],
  knowledgeSeriesQueryKey: (id: string) => ['knowledge-series', id],
  knowledgeSeriesUseCases: { get: () => ({ execute: getSeries }), setStatus: () => ({ execute: setStatus }) },
}));
vi.mock('../../../lib/backendAvailability', () => ({ isBackendUnavailable: () => false, notAvailableMessage: () => 'x' }));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
// The kit buttons become plain buttons; presses still reach the handler.
vi.mock('../../ui/Buttons', () => {
  const plain = ({ label, testID, onPress }: { label: string; testID?: string; onPress?: () => void }) => (
    <button data-testid={testID} onClick={onPress}>{label}</button>
  );
  return { DangerButton: plain, GhostButton: plain, SecondaryButton: plain };
});

import { KnowledgeSeriesPanel } from '../knowledge/KnowledgeSeriesPanel';

const SERIES: KnowledgeSlotSeries = {
  postId: 'l1', weekdays: [0, 2], startTime: '18:00', durationMinutes: 60, capacity: 2, endsOn: null, status: 'active',
};

function renderPanel(isOwner: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <KnowledgeSeriesPanel listingId="l1" cityId={null} isOwner={isOwner} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KnowledgeSeriesPanel', () => {
  it('shows nothing for a lesson with one-off times', async () => {
    getSeries.mockResolvedValue(null);
    const view = renderPanel(false);
    await waitFor(() => expect(getSeries).toHaveBeenCalledWith('l1'));
    expect(view.queryByTestId('knowledge-series-panel')).toBeNull();
  });

  it('shows a learner the schedule, without the giver controls', async () => {
    getSeries.mockResolvedValue(SERIES);
    const view = renderPanel(false);
    const schedule = await view.findByTestId('knowledge-series-schedule');
    expect(schedule.textContent).toContain('rideSeries.every');
    expect(schedule.textContent).toContain('18:00');
    expect(schedule.textContent).toContain('knowledgeBooking.series.israelTime');
    expect(schedule.textContent).toContain('knowledgeBooking.slotLength:60');
    expect(view.queryByTestId('knowledge-series-pause')).toBeNull();
  });

  it('lets the giver pause a running series', async () => {
    getSeries.mockResolvedValue(SERIES);
    setStatus.mockResolvedValue(undefined);
    const view = renderPanel(true);
    expect((await view.findByTestId('knowledge-series-status')).textContent).toBe('knowledgeBooking.series.status.active');
    fireEvent.click(view.getByTestId('knowledge-series-pause'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('l1', 'paused'));
  });

  it('offers resume on a paused series', async () => {
    getSeries.mockResolvedValue({ ...SERIES, status: 'paused' });
    const view = renderPanel(true);
    fireEvent.click(await view.findByTestId('knowledge-series-resume'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('l1', 'active'));
  });

  it('asks before ending, and ends only on yes', async () => {
    getSeries.mockResolvedValue(SERIES);
    setStatus.mockResolvedValue(undefined);
    const view = renderPanel(true);
    fireEvent.click(await view.findByTestId('knowledge-series-end'));
    expect(view.getByTestId('knowledge-series-end-confirm')).toBeTruthy();
    expect(setStatus).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId('knowledge-series-end-yes'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('l1', 'ended'));
  });

  it('offers no control on an ended series', async () => {
    getSeries.mockResolvedValue({ ...SERIES, status: 'ended' });
    const view = renderPanel(true);
    await view.findByTestId('knowledge-series-status');
    expect(view.queryByTestId('knowledge-series-resume')).toBeNull();
    expect(view.queryByTestId('knowledge-series-end')).toBeNull();
  });
});
