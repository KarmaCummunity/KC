// @vitest-environment jsdom
// G47 / D73 — the ride screen: the driver sees every booking and approves or declines each;
// a passenger books a chosen number of seats and follows their own booking.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../giving/RidePlaceField', () => ({ RidePlaceField: () => null }));
vi.mock('../../../hooks/useRidePlaces', () => ({ useRidePlaces: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarVisibility: () => false, shellTabBarHeightPx: () => 0, useShellTabBarScrollInset: () => 0 }));
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

const listForRide = vi.fn();
const approve = vi.fn();
const decline = vi.fn();
const book = vi.fn();
const completeRide = vi.fn();
const confirmAction = vi.fn();
const getForListing = vi.fn();
const rate = vi.fn();
const complete = vi.fn();
const cancel = vi.fn();
const routerPush = vi.fn();
const openRidePassengerChat = vi.fn();
let sessionUserId: string | null = 'u_driver';

vi.mock('expo-router', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('../../closure/OwnerAssignUserButton', () => ({ OwnerAssignUserButton: () => null }));
vi.mock('../../AvatarInitials', () => ({ AvatarInitials: () => null }));
// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) => select({ session: sessionUserId ? { userId: sessionUserId } : null }),
    { getState: () => ({ session: sessionUserId ? { userId: sessionUserId } : null }) },
  ),
}));
vi.mock('../../../services/ridesFeedComposition', () => ({
  RIDES_FEED_QUERY_KEY: ['rides-feed'],
}));
vi.mock('../../../services/rideBookingComposition', () => ({
  rideBookingsQueryKey: (id: string) => ['ride-bookings', id],
  openRidePassengerChat: (...args: unknown[]) => openRidePassengerChat(...args),
  rideBookingUseCases: {
    listForRide: () => ({ execute: listForRide }),
    approve: () => ({ execute: approve }),
    decline: () => ({ execute: decline }),
    book: () => ({ execute: book }),
    cancel: () => ({ execute: cancel }),
    complete: () => ({ execute: complete }),
    completeRide: () => ({ execute: completeRide }),
  },
}));
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: { getForListing: () => ({ execute: getForListing }), rate: () => ({ execute: rate }) },
}));
vi.mock('../../../services/platformConfirm', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../services/rideSafetyComposition', () => ({ raiseRideEmergency: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
// The card module pulls in native image/icon modules; only its time formatter is used here.
vi.mock('../../cards/ListingCard', () => ({ formatRideTime: (iso: string | null) => iso }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { RideBookingActions } from '../rides/RideBookingActions';
import { RidePassengerBooking } from '../rides/RidePassengerBooking';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  confirmAction.mockResolvedValue(true);
  sessionUserId = 'u_driver';
});

const DETAIL = {
  listingId: 'l_ride',
  ownerId: 'u_driver',
  worldSlug: 'rides',
  direction: 'give',
  cityId: null,
  details: { seats_available: 3 },
  listingStatus: 'open',
  availabilityStatus: 'open',
} as unknown as MarketplaceListingDetail;

function renderActions(detail: MarketplaceListingDetail = DETAIL) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <RideBookingActions detail={detail} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RideBookingActions — passenger', () => {
  it('books the chosen number of seats', async () => {
    sessionUserId = 'u_passenger';
    getForListing.mockResolvedValue(null);
    book.mockResolvedValue('h9');
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('giving-handoff-book-seat')).not.toBeNull());
    fireEvent.click(view.getByLabelText('rideBooking.moreSeats'));
    expect(view.getByTestId('ride-booking-seats').textContent).toBe('2');
    fireEvent.click(view.getByTestId('giving-handoff-book-seat'));
    await waitFor(() => expect(book).toHaveBeenCalledWith('l_ride', 2, { capacity: 3, departsAt: null }, { requestedMeetingPoint: null }));
    expect(listForRide).not.toHaveBeenCalled();
  });

  it('shows departed state when ride has already departed', async () => {
    sessionUserId = 'u_passenger';
    getForListing.mockResolvedValue(null);
    const pastDetail = {
      ...DETAIL,
      details: { seats_available: 3, departs_at: new Date(Date.now() - 10000).toISOString() },
    } as unknown as MarketplaceListingDetail;
    const view = renderActions(pastDetail);

    await waitFor(() => expect(view.queryByTestId('ride-booking-departed')).not.toBeNull());
    expect(view.queryByTestId('giving-handoff-book-seat')).toBeNull();
  });

  it('shows full state when capacity is zero', async () => {
    sessionUserId = 'u_passenger';
    getForListing.mockResolvedValue(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
          <RidePassengerBooking listingId="l_ride" cityId={null} capacity={0} details={{}} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(view.queryByTestId('ride-booking-full')).not.toBeNull());
    expect(view.queryByTestId('giving-handoff-book-seat')).toBeNull();
  });

  it('shows completed and rated state after rating, without showing booking form', async () => {
    sessionUserId = 'u_passenger';
    getForListing.mockResolvedValue({ handoffId: 'h1', status: 'handed_over' });
    rate.mockResolvedValue(undefined);
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('handoff-rating-form')).not.toBeNull());
    // Star rating buttons in form: choose 5 stars and submit
    fireEvent.click(view.getByTestId('handoff-rating-star-5'));
    fireEvent.click(view.getByTestId('handoff-rating-submit'));

    await waitFor(() => {
      expect(rate).toHaveBeenCalledWith('h1', 5, null);
      expect(view.queryByTestId('ride-booking-completed-rated')).not.toBeNull();
      // Ensure the "book seat" form does NOT reappear
      expect(view.queryByTestId('giving-handoff-book-seat')).toBeNull();
    });
    alertSpy.mockRestore();
  });

  it('shows a waiting booking with its deadline instead of the book button', async () => {
    sessionUserId = 'u_passenger';
    getForListing.mockResolvedValue({ handoffId: 'h1', status: 'reserved', confirmBy: '2026-11-01T10:00:00Z' });
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('ride-booking-waiting')).not.toBeNull());
    expect(view.queryByTestId('giving-handoff-book-seat')).toBeNull();
  });

  it('renders nothing for a guest or a ride request', () => {
    sessionUserId = null;
    expect(renderActions().container.textContent).toBe('');
    sessionUserId = 'u_passenger';
    expect(renderActions({ ...DETAIL, direction: 'request' } as MarketplaceListingDetail).container.textContent).toBe('');
  });
});

