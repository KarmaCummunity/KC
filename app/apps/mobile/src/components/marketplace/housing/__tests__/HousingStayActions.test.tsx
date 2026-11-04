// @vitest-environment jsdom
// FR-HOUSING-003 AC3, 015, 016 — the stay section of a housing offer: the host sees the bookings
// with their actions, a guest sees the request form; the request waits for valid input and for
// the code of conduct before it reaches the server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HousingHostBooking, MarketplaceListingDetail } from '@kc/domain';

vi.mock('react-native-reanimated', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => ({
  ...(await import('../../../ui/__tests__/kitDialogTestKit')).i18nDouble,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('../../../../services/platformConfirm', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../../lib/haptics', () => ({ hapticSuccess: () => undefined }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const state = vi.hoisted(() => ({ userId: 'u_guest' as string | null }));
vi.mock('../../../../store/authStore', () => ({
  useAuthStore: (select: (s: { session: { userId: string } | null }) => unknown) =>
    select({ session: state.userId ? { userId: state.userId } : null }),
}));

// The date picker is a native control; a button that picks a day 10 (check-in) or 12 (check-out)
// days from now stands in for it — inside the 180-day booking horizon (S54).
const DAY_MS = 24 * 60 * 60 * 1000;
vi.mock('../../../ui/DateTimeField', () => ({
  DateTimeField: ({ testID, onChange }: { testID: string; onChange: (d: Date) => void }) => (
    <button data-testid={testID} onClick={() => onChange(new Date(Date.now() + (testID.endsWith('in') ? 10 : 12) * DAY_MS))} />
  ),
}));

const BOOKING: HousingHostBooking = {
  handoffId: 'h1', guestId: 'u_guest', guestName: 'Dana', guestAvatarUrl: null, guestVerified: true,
  guestCompletedStays: 2, guestMemberSince: '2029-01-01T00:00:00Z', adults: 1, minors: 0, message: 'hi',
  status: 'reserved', reservedAt: '2030-01-01T00:00:00Z', confirmBy: '2030-01-02T00:00:00Z', ratedByMe: false,
  checkInDate: '2099-01-10', checkOutDate: '2099-01-12',
  startsAt: '2099-01-10T14:00:00Z', endsAt: '2099-01-12T08:00:00Z',
};

const useCases = vi.hoisted(() => ({
  conductAccepted: true,
  requestStay: vi.fn(async () => 'h9'),
  acceptConduct: vi.fn(async () => undefined),
  decide: vi.fn(async () => undefined),
}));
vi.mock('../../../../services/housingComposition', () => ({
  housingQueryKeys: {
    offerBookings: (id: string) => ['b', id], myStays: ['s'], privateDetails: (id: string) => ['p', id], conduct: ['c'],
  },
  openHousingChat: vi.fn(),
  housingUseCases: {
    listForOffer: () => ({ execute: async () => [BOOKING] }),
    listMyStays: () => ({ execute: async () => [] }),
    privateDetails: () => ({ execute: async () => null }),
    conductStatus: () => ({ execute: async () => ({ version: 1, accepted: useCases.conductAccepted }) }),
    acceptConduct: () => ({ execute: useCases.acceptConduct }),
    requestStay: () => ({ execute: useCases.requestStay }),
    decide: () => ({ execute: useCases.decide }),
  },
}));
vi.mock('../../../../services/givingHandoffComposition', () => ({ givingHandoffUseCases: {} }));

import { HousingStayActions } from '../HousingStayActions';
import { renderInTheme } from '../../../ui/__tests__/kitDialogTestKit';

const DETAIL = {
  listingId: 'l1', worldSlug: 'housing', direction: 'give', ownerId: 'u_host',
  details: { min_nights: 1, max_nights: 5, children_ok: true, capacity: 2 },
} as unknown as MarketplaceListingDetail;

function renderSection(detail: MarketplaceListingDetail = DETAIL) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInTheme(
    <QueryClientProvider client={client}>
      <HousingStayActions detail={detail} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.userId = 'u_guest';
  useCases.conductAccepted = true;
});

/** Picks both dates and writes a message, the minimum for a valid request. */
async function fillRequest(view: ReturnType<typeof renderSection>) {
  await act(async () => {
    fireEvent.click(view.getByTestId('housing-request-check-in'));
    fireEvent.click(view.getByTestId('housing-request-check-out'));
  });
  fireEvent.change(view.getByTestId('housing-request-message'), { target: { value: 'Walking the trail' } });
}

describe('HousingStayActions', () => {
  it('shows nothing to a signed-out viewer or on a stay request', () => {
    state.userId = null;
    expect(renderSection().container.textContent).toBe('');
    cleanup();
    state.userId = 'u_guest';
    expect(renderSection({ ...DETAIL, direction: 'request' } as MarketplaceListingDetail).container.textContent).toBe('');
  });

  it('the host sees every booking and approves one', async () => {
    state.userId = 'u_host';
    const view = renderSection();
    const approve = await view.findByTestId('housing-approve-h1');
    await act(async () => fireEvent.click(approve));
    expect(useCases.decide).toHaveBeenCalledWith(BOOKING, true);
  });

  it('a guest cannot send until the dates and a message are in', async () => {
    const view = renderSection();
    const send = await view.findByTestId('housing-request-send');
    expect(send.getAttribute('aria-disabled') === 'true' || (send as HTMLButtonElement).disabled).toBe(true);
    await fillRequest(view);
    await act(async () => fireEvent.click(view.getByTestId('housing-request-send')));
    expect(useCases.requestStay).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'l1', message: 'Walking the trail', adults: 1, minors: 0 }),
      expect.objectContaining({ maxNights: 5 }),
      expect.any(String),
    );
  });

  it('asks for the code of conduct first, then sends the waiting request', async () => {
    useCases.conductAccepted = false;
    const view = renderSection();
    await view.findByTestId('housing-request-send');
    await waitFor(() => expect(useCases.requestStay).not.toHaveBeenCalled());
    await fillRequest(view);
    await act(async () => fireEvent.click(view.getByTestId('housing-request-send')));
    expect(useCases.requestStay).not.toHaveBeenCalled();
    // react-native-web renders a Switch as a wrapper around a checkbox input; the input toggles it.
    const agree = view.getByTestId('housing-conduct-agree').querySelector('input') ?? view.getByTestId('housing-conduct-agree');
    await act(async () => fireEvent.click(agree));
    await act(async () => fireEvent.click(view.getByTestId('housing-conduct-accept')));
    expect(useCases.acceptConduct).toHaveBeenCalledWith(1);
    await waitFor(() => expect(useCases.requestStay).toHaveBeenCalledTimes(1));
  });
});
