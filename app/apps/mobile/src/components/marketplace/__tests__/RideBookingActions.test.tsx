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
let sessionUserId: string | null = 'u_driver';

// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: sessionUserId ? { userId: sessionUserId } : null }),
}));
vi.mock('../../../services/rideBookingComposition', () => ({
  rideBookingsQueryKey: (id: string) => ['ride-bookings', id],
  rideBookingUseCases: {
    listForRide: () => ({ execute: listForRide }),
    approve: () => ({ execute: approve }),
    decline: () => ({ execute: decline }),
    book: () => ({ execute: book }),
    cancel: () => ({ execute: vi.fn() }),
    complete: () => ({ execute: vi.fn() }),
  },
}));
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: { getForListing: () => ({ execute: getForListing }), rate: () => ({ execute: vi.fn() }) },
}));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../services/rideSafetyComposition', () => ({ raiseRideEmergency: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
// The card module pulls in native image/icon modules; only its time formatter is used here.
vi.mock('../../cards/ListingCard', () => ({ formatRideTime: (iso: string | null) => iso }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { RideBookingActions, rideCapacity } from '../rides/RideBookingActions';

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
    await waitFor(() => expect(useCase).toHaveBeenCalledWith('h1'));
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
    await waitFor(() => expect(book).toHaveBeenCalledWith('l_ride', 2));
    expect(listForRide).not.toHaveBeenCalled();
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
