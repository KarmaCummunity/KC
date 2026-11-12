// @vitest-environment jsdom
// FR-FEED-020 AC2 — the time world screen keeps the organisations' volunteering opportunities:
// a three-row preview that expands in place to the whole list, each row opening its
// opportunity; nothing renders when no organisation recruits.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({ push: vi.fn(), execute: vi.fn() }));

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count === undefined ? k : `${k}:${o.count}`),
    i18n: { language: 'he' },
  }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../services/volunteerComposition', () => ({
  volunteerUseCases: { listOpportunities: () => ({ execute: mocks.execute }) },
}));
vi.mock('../../cards/KcRowCard', () => ({
  KcRowCard: ({ testID, title, onPress }: { testID: string; title: string; onPress: () => void }) => (
    <button data-testid={testID} onClick={onPress}>
      {title}
    </button>
  ),
}));

import { TIME_OPPORTUNITIES_PREVIEW, TimeOpportunitiesSection, formatShiftStart } from '../time/TimeOpportunitiesSection';

const opportunity = (n: number) => ({
  opportunityId: `o${n}`,
  title: `Shift ${n}`,
  locationLabel: 'Lod',
  openSlots: n,
  nextShiftAt: null,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <TimeOpportunitiesSection />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TimeOpportunitiesSection', () => {
  it('previews three opportunities, expands to all of them and collapses again', async () => {
    mocks.execute.mockResolvedValue([1, 2, 3, 4, 5].map(opportunity));
    renderSection();
    expect(await screen.findByTestId('opportunity-row-o1')).toBeTruthy();
    expect(screen.queryByTestId('opportunity-row-o4')).toBeNull();
    expect(TIME_OPPORTUNITIES_PREVIEW).toBe(3);

    const toggle = screen.getByTestId('time-opportunities-toggle');
    expect(toggle.textContent).toContain('donations.worldFeed.timeOpportunitiesShowAll:5');
    fireEvent.click(toggle);
    expect(screen.getByTestId('opportunity-row-o5')).toBeTruthy();

    fireEvent.click(screen.getByTestId('time-opportunities-toggle'));
    expect(screen.queryByTestId('opportunity-row-o4')).toBeNull();
    expect(mocks.execute).toHaveBeenCalledWith(40);
  });

  it('shows a short list in full, without a toggle, and opens a row', async () => {
    mocks.execute.mockResolvedValue([1, 2].map(opportunity));
    renderSection();
    fireEvent.click(await screen.findByTestId('opportunity-row-o2'));
    expect(screen.queryByTestId('time-opportunities-toggle')).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/(tabs)/donations/time/opportunity/[opportunityId]',
      params: { opportunityId: 'o2' },
    });
  });

  it('renders nothing when no organisation recruits', async () => {
    mocks.execute.mockResolvedValue([]);
    const view = renderSection();
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    expect(view.queryByTestId('time-opportunities')).toBeNull();
  });
});

describe('formatShiftStart', () => {
  it('formats a shift start, and keeps an unparseable value as it came', () => {
    expect(formatShiftStart(null, 'he')).toBe('');
    expect(formatShiftStart('not-a-date', 'he')).toBe('not-a-date');
    expect(formatShiftStart('2026-11-03T08:30:00.000Z', 'en')).toMatch(/2026/);
  });
});
