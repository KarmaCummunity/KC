// @vitest-environment jsdom
// G18 (D124 / D131) — an organizer ends an event instead of the item close: the confirmation says
// what happens to the registrations (cancelled before the start, kept after it), then the event
// is closed through fulfill_my_listing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({ fulfillMyListing: vi.fn(), back: vi.fn(), toast: vi.fn() }));

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: mocks.back, canGoBack: () => true }) }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ fulfillMyListing: mocks.fulfillMyListing }),
}));
vi.mock('../../../store/feedSessionStore', () => ({
  useFeedSessionStore: { getState: () => ({ showEphemeralToast: mocks.toast }) },
}));

import { EventOwnerCloseBar } from '../EventOwnerCloseBar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBar(startsAt: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <EventOwnerCloseBar listingId="listing-1" startsAt={startsAt} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('EventOwnerCloseBar', () => {
  it('warns that ending an upcoming event cancels its registrations, then ends it', async () => {
    mocks.fulfillMyListing.mockResolvedValue(undefined);
    const view = renderBar('2099-01-01T10:00:00Z');
    fireEvent.click(view.getByTestId('event-owner-close-open'));
    expect(view.getByText('eventPost.ownerClose.beforeStart')).toBeTruthy();
    fireEvent.click(view.getByText('eventPost.ownerClose.confirm'));
    await waitFor(() => expect(mocks.fulfillMyListing).toHaveBeenCalledWith('listing-1'));
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
  });

  it('tells the organizer of a started event that attendance can still be marked', () => {
    const view = renderBar('2000-01-01T10:00:00Z');
    fireEvent.click(view.getByTestId('event-owner-close-open'));
    expect(view.getByText('eventPost.ownerClose.afterStart')).toBeTruthy();
  });
});
