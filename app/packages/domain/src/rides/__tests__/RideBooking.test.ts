import { describe, expect, it } from 'vitest';
import {
  canApproveRideBooking,
  canBookRideSeats,
  canReinstateRideBooking,
  canPerformBookingAction,
  getRideRemainingCapacity,
  isRideBookingStatus,
  isRideTripCompletable,
  isValidRideBookingSeats,
  isValidRideBookingTransition,
  summarizeRideSeats,
  type RideBooking,
  type RideBookingStatus,
} from '../RideBooking';

function booking(status: RideBooking['status'], seats: number): RideBooking {
  return {
    handoffId: `h-${status}-${seats}`,
    recipientId: 'u1',
    passengerName: 'Dana',
    avatarUrl: null,
    seats,
    status,
    reservedAt: '2026-11-01T08:00:00Z',
    confirmBy: null,
    ratedByMe: false,
    requestedStopLabel: null,
  };
}

describe('summarizeRideSeats', () => {
  it('splits seats by booking status and counts what is left', () => {
    const out = summarizeRideSeats(4, [booking('reserved', 1), booking('confirmed', 2)]);
    expect(out).toEqual({ capacity: 4, waiting: 1, approved: 2, completed: 0, free: 1 });
  });

  it('counts completed seats as taken', () => {
    expect(summarizeRideSeats(2, [booking('handed_over', 2)]).free).toBe(0);
  });

  it('never reports negative free seats when bookings exceed capacity', () => {
    expect(summarizeRideSeats(1, [booking('confirmed', 3)]).free).toBe(0);
  });

  it('treats a negative capacity as zero', () => {
    expect(summarizeRideSeats(-2, []).capacity).toBe(0);
  });
});

describe('isValidRideBookingSeats', () => {
  it.each([1, 4, 8])('accepts %i seats', (n) => expect(isValidRideBookingSeats(n)).toBe(true));
  it.each([0, 9, 1.5, Number.NaN])('rejects %s seats', (n) => expect(isValidRideBookingSeats(n)).toBe(false));
});

describe('isRideBookingStatus', () => {
  it('accepts managed statuses and rejects cancelled history', () => {
    expect(isRideBookingStatus('confirmed')).toBe(true);
    expect(isRideBookingStatus('cancelled')).toBe(false);
  });
});

describe('getRideRemainingCapacity', () => {
  it('deducts only confirmed and completed bookings from capacity', () => {
    const list = [booking('reserved', 2), booking('confirmed', 1), booking('handed_over', 1)];
    expect(getRideRemainingCapacity(4, list)).toBe(2);
  });

  it('floors at zero when committed bookings exceed capacity', () => {
    expect(getRideRemainingCapacity(2, [booking('confirmed', 3)])).toBe(0);
  });
});

describe('canApproveRideBooking — seat counting and capacity guards', () => {
  it('allows approval when requested seats fit in remaining capacity', () => {
    const target = booking('reserved', 2);
    const list = [target, booking('confirmed', 1)];
    expect(canApproveRideBooking(4, list, target)).toBe(true);
  });

  it('rejects approval when requested seats exceed remaining capacity (accepting beyond capacity)', () => {
    const target = booking('reserved', 2);
    const list = [target, booking('confirmed', 2)];
    // capacity 3, confirmed takes 2, remaining is 1. target needs 2 -> beyond capacity.
    expect(canApproveRideBooking(3, list, target)).toBe(false);
  });

  it('rejects approval if target booking is not reserved', () => {
    const confirmed = booking('confirmed', 1);
    expect(canApproveRideBooking(3, [confirmed], confirmed)).toBe(false);
  });

  it('looks up booking by handoffId if string passed', () => {
    const b = booking('reserved', 1);
    expect(canApproveRideBooking(3, [b], b.handoffId)).toBe(true);
    expect(canApproveRideBooking(3, [b], 'missing_id')).toBe(false);
  });
});

describe('canBookRideSeats — passenger seat counting', () => {
  it('allows booking when requested seats <= free seats', () => {
    const list = [booking('confirmed', 1)];
    expect(canBookRideSeats(3, list, 2)).toBe(true);
  });

  it('rejects booking when no seats left (free seats == 0)', () => {
    const list = [booking('confirmed', 2)];
    expect(canBookRideSeats(2, list, 1)).toBe(false);
  });

  it('rejects booking when requested seats exceed free seats', () => {
    const list = [booking('confirmed', 1)];
    expect(canBookRideSeats(2, list, 2)).toBe(false);
  });

  it('rejects invalid seats', () => {
    expect(canBookRideSeats(4, [], 0)).toBe(false);
    expect(canBookRideSeats(4, [], 9)).toBe(false);
  });
});

describe('isValidRideBookingTransition', () => {
  it.each([
    ['reserved', 'confirmed'],
    ['reserved', 'handed_over'],
    ['reserved', 'cancelled'],
    ['confirmed', 'handed_over'],
    ['confirmed', 'cancelled'],
  ] as const)('permits valid transition from %s to %s', (from, to) => {
    expect(isValidRideBookingTransition(from, to)).toBe(true);
  });

  it.each([
    ['confirmed', 'reserved'],
    ['handed_over', 'confirmed'],
    ['handed_over', 'cancelled'],
    ['cancelled', 'reserved'],
    ['cancelled', 'confirmed'],
  ] as const)('rejects invalid transition from %s to %s', (from, to) => {
    expect(isValidRideBookingTransition(from as unknown as RideBookingStatus, to as unknown as RideBookingStatus)).toBe(false);
  });
});

describe('canPerformBookingAction', () => {
  it('permits approve and decline only on reserved', () => {
    expect(canPerformBookingAction('reserved', 'approve')).toBe(true);
    expect(canPerformBookingAction('reserved', 'decline')).toBe(true);
    expect(canPerformBookingAction('confirmed', 'approve')).toBe(false);
    expect(canPerformBookingAction('confirmed', 'decline')).toBe(false);
  });

  it('permits cancel on reserved and confirmed, rejects on terminal', () => {
    expect(canPerformBookingAction('reserved', 'cancel')).toBe(true);
    expect(canPerformBookingAction('confirmed', 'cancel')).toBe(true);
    expect(canPerformBookingAction('handed_over', 'cancel')).toBe(false);
  });

  it('rejects unknown booking actions', () => {
    // @ts-expect-error testing default case
    expect(canPerformBookingAction('confirmed', 'unknown_action')).toBe(false);
  });

  it('permits complete on confirmed and reserved', () => {
    expect(canPerformBookingAction('confirmed', 'complete')).toBe(true);
    expect(canPerformBookingAction('reserved', 'complete')).toBe(true);
    expect(canPerformBookingAction('handed_over', 'complete')).toBe(false);
  });

  it('permits rate only on handed_over when unrated', () => {
    expect(canPerformBookingAction('handed_over', 'rate', false)).toBe(true);
    expect(canPerformBookingAction('handed_over', 'rate', true)).toBe(false);
    expect(canPerformBookingAction('confirmed', 'rate', false)).toBe(false);
  });
});

describe('isRideTripCompletable', () => {
  const base = new Date('2026-11-02T12:00:00Z');

  it('returns true when now is within 1 hour before departure', () => {
    const departs = '2026-11-02T12:45:00Z'; // 45 min ahead
    expect(isRideTripCompletable(departs, base)).toBe(true);
  });

  it('returns false when departure is more than 1 hour in the future', () => {
    const departs = '2026-11-02T13:30:00Z'; // 1h 30m ahead
    expect(isRideTripCompletable(departs, base)).toBe(false);
  });

  it('returns true when departure is past, missing, or invalid', () => {
    expect(isRideTripCompletable('2026-11-02T11:00:00Z', base)).toBe(true);
    expect(isRideTripCompletable(null, base)).toBe(true);
    expect(isRideTripCompletable(undefined, base)).toBe(true);
    expect(isRideTripCompletable('invalid-date', base)).toBe(true);
  });
});

describe('canReinstateRideBooking', () => {
  it('allows driver-cancelled and declined rows only', () => {
    const base = booking('cancelled', 1);
    expect(canReinstateRideBooking({ ...base, cancelReason: 'driver_cancelled' })).toBe(true);
    expect(canReinstateRideBooking({ ...base, cancelReason: 'declined' })).toBe(true);
    expect(canReinstateRideBooking({ ...base, cancelReason: 'expired' })).toBe(false);
    expect(canReinstateRideBooking(booking('confirmed', 1))).toBe(false);
  });
});
