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
  ReinstateRideBookingUseCase,
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
  requestedStopLabel: null,
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
    reinstate: vi.fn<IRideBookingRepository['reinstate']>(async () => undefined),
  } satisfies IRideBookingRepository;
}

describe('ride booking use cases', () => {
  it('books the requested seats and returns the booking id', async () => {
    const repo = makeRepo();
    await expect(new BookRideSeatUseCase(repo).execute('l1', 2)).resolves.toBe('h1');
    expect(repo.bookSeat).toHaveBeenCalledWith('l1', 2, null);
  });

  it('books one seat by default', async () => {
    const repo = makeRepo();
    await new BookRideSeatUseCase(repo).execute('l1');
    expect(repo.bookSeat).toHaveBeenCalledWith('l1', 1, null);
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

  describe('ApproveRideBookingUseCase — capacity and status validation', () => {
    it('approves when requested seats fit in remaining capacity', async () => {
      const repo = makeRepo();
      const target: RideBooking = { ...BOOKING, handoffId: 'h1', seats: 2, status: 'reserved' };
      const other: RideBooking = { ...BOOKING, handoffId: 'h2', seats: 1, status: 'confirmed' };
      // capacity 4, confirmed takes 1, remaining 3. target needs 2 -> OK.
      await new ApproveRideBookingUseCase(repo).execute('h1', { capacity: 4, bookings: [target, other] });
      expect(repo.approve).toHaveBeenCalledWith('h1');
    });

    it('rejects approval beyond capacity without calling server', async () => {
      const repo = makeRepo();
      const target: RideBooking = { ...BOOKING, handoffId: 'h1', seats: 2, status: 'reserved' };
      const other: RideBooking = { ...BOOKING, handoffId: 'h2', seats: 2, status: 'confirmed' };
      // capacity 3, confirmed takes 2, remaining 1. target needs 2 -> exceeds capacity.
      const uc = new ApproveRideBookingUseCase(repo);
      await expect(uc.execute('h1', { capacity: 3, bookings: [target, other] })).rejects.toMatchObject({
        code: 'seats_exhausted',
      });
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it('rejects approval of non-reserved booking (invalid transition)', async () => {
      const repo = makeRepo();
      const alreadyConfirmed: RideBooking = { ...BOOKING, handoffId: 'h1', status: 'confirmed' };
      const uc = new ApproveRideBookingUseCase(repo);
      await expect(uc.execute('h1', { capacity: 3, bookings: [alreadyConfirmed] })).rejects.toMatchObject({
        code: 'invalid_status',
      });
      expect(repo.approve).not.toHaveBeenCalled();
    });
  });

  describe('DeclineRideBookingUseCase — status validation', () => {
    it('rejects declining a confirmed booking (invalid transition)', async () => {
      const repo = makeRepo();
      const confirmed: RideBooking = { ...BOOKING, handoffId: 'h1', status: 'confirmed' };
      const uc = new DeclineRideBookingUseCase(repo);
      await expect(uc.execute('h1', { bookings: [confirmed] })).rejects.toMatchObject({
        code: 'invalid_status',
      });
      expect(repo.decline).not.toHaveBeenCalled();
    });
  });

  describe('CancelRideBookingUseCase — status validation', () => {
    it.each(['handed_over', 'cancelled'] as const)(
      'rejects cancelling a %s booking (invalid transition)',
      async (status) => {
        const repo = makeRepo();
        const uc = new CancelRideBookingUseCase(repo);
        await expect(uc.execute('h1', { status })).rejects.toMatchObject({
          code: 'invalid_status',
        });
        expect(repo.cancel).not.toHaveBeenCalled();
      },
    );

    it.each(['reserved', 'confirmed'] as const)('cancels a %s booking', async (status) => {
      const repo = makeRepo();
      await new CancelRideBookingUseCase(repo).execute('h1', { status });
      expect(repo.cancel).toHaveBeenCalledWith('h1');
    });
  });

  describe('CompleteRideTripUseCase — status and timing validation', () => {
    it('rejects completion on already completed trip', async () => {
      const repo = makeRepo();
      const uc = new CompleteRideTripUseCase(repo);
      await expect(uc.execute('h1', { status: 'handed_over' })).rejects.toMatchObject({
        code: 'invalid_status',
      });
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('rejects completion when ride is more than 1 hour in the future', async () => {
      const repo = makeRepo();
      const uc = new CompleteRideTripUseCase(repo);
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await expect(uc.execute('h1', { status: 'confirmed', departsAt: future })).rejects.toMatchObject({
        code: 'ride_not_started',
      });
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('completes trip when within 1 hour before departure', async () => {
      const repo = makeRepo();
      const uc = new CompleteRideTripUseCase(repo);
      const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await uc.execute('h1', { status: 'confirmed', departsAt: soon });
      expect(repo.complete).toHaveBeenCalledWith('h1');
    });
  });

  describe('BookRideSeatUseCase — seat count and departure validation', () => {
    it('rejects booking on departed ride', async () => {
      const repo = makeRepo();
      const past = new Date(Date.now() - 1000).toISOString();
      await expect(new BookRideSeatUseCase(repo).execute('l1', 1, { departsAt: past })).rejects.toMatchObject({
        code: 'ride_departed',
      });
      expect(repo.bookSeat).not.toHaveBeenCalled();
    });

    it('rejects booking when no seats left (freeSeats == 0)', async () => {
      const repo = makeRepo();
      await expect(new BookRideSeatUseCase(repo).execute('l1', 1, { freeSeats: 0 })).rejects.toMatchObject({
        code: 'seats_exhausted',
      });
      expect(repo.bookSeat).not.toHaveBeenCalled();
    });

    it('rejects booking when requested seats exceed free seats', async () => {
      const repo = makeRepo();
      await expect(new BookRideSeatUseCase(repo).execute('l1', 3, { freeSeats: 2 })).rejects.toMatchObject({
        code: 'seats_exhausted',
      });
      expect(repo.bookSeat).not.toHaveBeenCalled();
    });

    it('rejects booking when requested seats exceed capacity', async () => {
      const repo = makeRepo();
      await expect(new BookRideSeatUseCase(repo).execute('l1', 4, { capacity: 3 })).rejects.toMatchObject({
        code: 'seats_exhausted',
      });
      expect(repo.bookSeat).not.toHaveBeenCalled();
    });
  });

  it('reinstates only a cancellable driver-list row', async () => {
    const repo = makeRepo();
    const cancelled: RideBooking = { ...BOOKING, status: 'cancelled', cancelReason: 'driver_cancelled' };
    await new ReinstateRideBookingUseCase(repo).execute('h1', { bookings: [cancelled] });
    expect(repo.reinstate).toHaveBeenCalledWith('h1');

    await expect(
      new ReinstateRideBookingUseCase(repo).execute('h1', {
        bookings: [{ ...cancelled, cancelReason: 'expired' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_status' });
  });
});
