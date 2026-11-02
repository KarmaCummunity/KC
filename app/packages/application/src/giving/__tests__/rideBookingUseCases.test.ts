import { describe, expect, it, vi } from 'vitest';
import { RideError, type RideBooking } from '@kc/domain';
import type { IRideBookingRepository } from '../../ports/IRideBookingRepository';
import {
  ApproveRideBookingUseCase,
  BookRideSeatUseCase,
  CancelRideBookingUseCase,
  CompleteRideTripUseCase,
  CompleteRideListingUseCase,
  DeclineRideBookingUseCase,
  ListRideBookingsUseCase,
} from '../rideBookingUseCases';

const BOOKING: RideBooking = {
  handoffId: 'h1',
  recipientId: 'u1',
  passengerName: 'Dana',
  avatarUrl: null,
  seats: 1,
  status: 'reserved',
  reservedAt: '2026-11-01T08:00:00Z',
  confirmBy: '2026-11-01T10:00:00Z',
  ratedByMe: false,
};

/** Typed fake: each method is a mock with the port's exact signature. */
function makeRepo() {
  return {
    bookSeat: vi.fn<IRideBookingRepository['bookSeat']>(async () => 'h1'),
    listForRide: vi.fn<IRideBookingRepository['listForRide']>(async () => [BOOKING]),
    approve: vi.fn<IRideBookingRepository['approve']>(async () => undefined),
    decline: vi.fn<IRideBookingRepository['decline']>(async () => undefined),
    cancel: vi.fn<IRideBookingRepository['cancel']>(async () => undefined),
    complete: vi.fn<IRideBookingRepository['complete']>(async () => undefined),
    completeRide: vi.fn<IRideBookingRepository['completeRide']>(async () => 2),
  } satisfies IRideBookingRepository;
}

describe('ride booking use cases', () => {
  it('books the requested seats and returns the booking id', async () => {
    const repo = makeRepo();
    await expect(new BookRideSeatUseCase(repo).execute('l1', 2)).resolves.toBe('h1');
    expect(repo.bookSeat).toHaveBeenCalledWith('l1', 2);
  });

  it('books one seat by default', async () => {
    const repo = makeRepo();
    await new BookRideSeatUseCase(repo).execute('l1');
    expect(repo.bookSeat).toHaveBeenCalledWith('l1', 1);
  });

  it.each([0, 9, 1.5])('rejects %s seats without calling the server', async (seats) => {
    const repo = makeRepo();
    await expect(new BookRideSeatUseCase(repo).execute('l1', seats)).rejects.toBeInstanceOf(RideError);
    expect(repo.bookSeat).not.toHaveBeenCalled();
  });

  it('lists the bookings on a ride', async () => {
    const repo = makeRepo();
    await expect(new ListRideBookingsUseCase(repo).execute('l1')).resolves.toEqual([BOOKING]);
    expect(repo.listForRide).toHaveBeenCalledWith('l1');
  });

  it.each([
    ['approve', ApproveRideBookingUseCase],
    ['decline', DeclineRideBookingUseCase],
    ['cancel', CancelRideBookingUseCase],
    ['complete', CompleteRideTripUseCase],
  ] as const)('%s delegates the booking id', async (method, UseCase) => {
    const repo = makeRepo();
    await new UseCase(repo).execute('h1');
    expect(repo[method]).toHaveBeenCalledWith('h1');
  });

  it('lets the driver complete a ride listing and reports completed bookings', async () => {
    const repo = makeRepo();
    await expect(new CompleteRideListingUseCase(repo).execute('l1')).resolves.toBe(2);
    expect(repo.completeRide).toHaveBeenCalledWith('l1');
  });

  it('surfaces server errors unchanged', async () => {
    const repo = makeRepo();
    repo.decline.mockRejectedValueOnce(new Error('invalid_status'));
    await expect(new DeclineRideBookingUseCase(repo).execute('h1')).rejects.toThrow('invalid_status');
  });
});
