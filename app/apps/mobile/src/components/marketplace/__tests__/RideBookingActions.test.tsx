// @vitest-environment jsdom
// G47 / D73 — the ride screen: the driver sees every booking and approves or declines each;
// a passenger books a chosen number of seats and follows their own booking.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail, RideBooking } from '@kc/domain';

const listForRide = vi.fn();
const approve = vi.fn();
const decline = vi.fn();
const book = vi.fn();
const getForListing = vi.fn();
const rate = vi.fn();
const complete = vi.fn();
const cancel = vi.fn();
const routerPush = vi.fn();
const openRidePassengerChat = vi.fn();
let sessionUserId: string | null = 'u_driver';

vi.mock('expo-router', () => ({ useRouter: () => ({ push: routerPush }) }));
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
  },
}));
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: { getForListing: () => ({ execute: getForListing }), rate: () => ({ execute: rate }) },
}));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../services/rideSafetyComposition', () => ({ raiseRideEmergency: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
// The card module pulls in native image/icon modules; only its time formatter is used here.
vi.mock('../../cards/ListingCard', () => ({ formatRideTime: (iso: string | null) => iso }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { RideBookingActions, rideCapacity } from '../rides/RideBookingActions';
import { RidePassengerBooking } from '../rides/RidePassengerBooking';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionUserId = 'u_driver';
});

const DETAIL = {
  listingId: 'l_ride',
  ownerId: 'u_driver',
  worldSlug: 'rides',
  direction: 'give',
  cityId: null,
  details: { seats_available: 3 },
} as unknown as MarketplaceListingDetail;

function booking(handoffId: string, status: RideBooking['status'], seats = 1): RideBooking {
  return {
    handoffId,
    recipientId: `u_${handoffId}`,
    passengerName: `Passenger ${handoffId}`,
    avatarUrl: null,
    seats,
    status,
    reservedAt: '2026-11-01T08:00:00Z',
    confirmBy: '2026-11-01T10:00:00Z',
    ratedByMe: false,
  };
}

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

describe('RideBookingActions — driver', () => {
  it('lists every booking with the seats still free', async () => {
    listForRide.mockResolvedValue([booking('h1', 'reserved'), booking('h2', 'confirmed')]);
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('ride-booking-h1')).not.toBeNull());
    expect(view.queryByTestId('ride-booking-h2')).not.toBeNull();
    expect(listForRide).toHaveBeenCalledWith('l_ride');
    expect(view.getByTestId('ride-bookings-seats').textContent).toBe('rideBooking.seatSummary');
  });

  it.each([
    ['approve', approve],
    ['decline', decline],
  ] as const)('can %s only a waiting booking', async (action, useCase) => {
    listForRide.mockResolvedValue([booking('h1', 'reserved'), booking('h2', 'confirmed')]);
    useCase.mockResolvedValue(undefined);
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId(`ride-booking-${action}-h1`)).not.toBeNull());
    expect(view.queryByTestId(`ride-booking-${action}-h2`)).toBeNull();
    fireEvent.click(view.getByTestId(`ride-booking-${action}-h1`));
    await waitFor(() => expect(useCase).toHaveBeenCalledWith('h1', expect.anything()));
  });

  it('shows the empty state when no one booked yet', async () => {
    listForRide.mockResolvedValue([]);
    const view = renderActions();
    await waitFor(() => expect(view.queryByTestId('ride-bookings-empty')).not.toBeNull());
  });

  it('alerts with the server error copy when an action fails', async () => {
    listForRide.mockResolvedValue([booking('h1', 'reserved')]);
    approve.mockRejectedValue(new Error('invalid_status'));
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('ride-booking-approve-h1')).not.toBeNull());
    fireEvent.click(view.getByTestId('ride-booking-approve-h1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('marketplace.errors.invalid_status'));
    alertSpy.mockRestore();
  });

  it('disables approve and shows warning when requested seats exceed remaining capacity (accepting beyond capacity)', async () => {
    // Capacity 3: h1 is confirmed (2 seats), remaining capacity is 1. h2 requests 2 seats -> exceeds capacity!
    listForRide.mockResolvedValue([booking('h1', 'confirmed', 2), booking('h2', 'reserved', 2)]);
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('ride-booking-h2')).not.toBeNull());
    // h2 approve button should be disabled
    const approveBtn = view.getByTestId('ride-booking-approve-h2');
    expect(approveBtn.getAttribute('aria-disabled')).toBe('true');
    // Warning caption should be visible
    expect(view.queryByTestId('ride-booking-exceeds-h2')).not.toBeNull();
    // Decline button should remain enabled
    const declineBtn = view.getByTestId('ride-booking-decline-h2');
    expect(declineBtn.getAttribute('aria-disabled')).toBeNull();
  });

  it('opens a chat thread with the passenger on chat button click', async () => {
    listForRide.mockResolvedValue([booking('h1', 'confirmed', 1)]);
    openRidePassengerChat.mockResolvedValue('c_123');
    const view = renderActions();

    await waitFor(() => expect(view.queryByTestId('ride-booking-chat-h1')).not.toBeNull());
    fireEvent.click(view.getByTestId('ride-booking-chat-h1'));

    await waitFor(() => {
      expect(openRidePassengerChat).toHaveBeenCalledWith('u_driver', 'u_h1');
      expect(routerPush).toHaveBeenCalledWith('/chat/c_123');
    });
  });
});

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
    await waitFor(() => expect(book).toHaveBeenCalledWith('l_ride', 2, { capacity: 3, departsAt: null }));
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

describe('rideCapacity', () => {
  it('reads the offered seats and falls back to one', () => {
    expect(rideCapacity({ seats_available: 4 })).toBe(4);
    expect(rideCapacity({ seats_available: 0 })).toBe(1);
    expect(rideCapacity({})).toBe(1);
  });
});
