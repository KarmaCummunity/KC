import { describe, expect, it, vi } from 'vitest';
import { SupabaseRideBookingRepository, mapBookingRow } from '../SupabaseRideBookingRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRideBookingRepository>[0];

const ROW = {
  handoff_id: 'h1',
  recipient_id: 'u1',
  passenger_name: 'Dana',
  avatar_url: null,
  seats: 2,
  status: 'reserved',
  reserved_at: '2026-11-01T08:00:00Z',
  confirm_by: '2026-11-01T10:00:00Z',
  rated_by_me: true,
  requested_stop_label: 'מחלף גלילות',
  cancel_reason: null as unknown as string,
};

function repoWith(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const client = { rpc, from: vi.fn() } as unknown as AnyClient;
  return { rpc, repo: new SupabaseRideBookingRepository(client) };
}

describe('SupabaseRideBookingRepository', () => {
  it('books seats and returns the new booking id', async () => {
    const { rpc, repo } = repoWith({ data: { handoff_id: 'h9' }, error: null });
    await expect(repo.bookSeat('l1', 2)).resolves.toBe('h9');
    expect(rpc).toHaveBeenCalledWith('book_ride_seat', {
      p_listing_id: 'l1',
      p_seats: 2,
      p_requested_meeting_point: undefined,
    });
  });

  it('throws when bookSeat RPC returns an error', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'no_seats_available' } });
    await expect(repo.bookSeat('l1', 5)).rejects.toThrow('no_seats_available');
  });

  it('maps the driver bookings list to camelCase', async () => {
    const { rpc, repo } = repoWith({ data: [ROW], error: null });
    await expect(repo.listForRide('l1')).resolves.toEqual([
      {
        handoffId: 'h1',
        recipientId: 'u1',
        passengerName: 'Dana',
        avatarUrl: null,
        seats: 2,
        status: 'reserved',
        reservedAt: '2026-11-01T08:00:00Z',
        confirmBy: '2026-11-01T10:00:00Z',
        ratedByMe: true,
        requestedStopLabel: 'מחלף גלילות',
        cancelReason: null,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith('list_ride_bookings', { p_listing_id: 'l1' });
  });

  it('keeps a cancelled row with its reason so the driver can reinstate it', async () => {
    const { repo } = repoWith({ data: [{ ...ROW, status: 'cancelled', cancel_reason: 'declined' }], error: null });
    await expect(repo.listForRide('l1')).resolves.toMatchObject([{ status: 'cancelled', cancelReason: 'declined' }]);
  });

  it('drops rows with a status the driver does not manage', async () => {
    const { repo } = repoWith({ data: [{ ...ROW, status: 'expired' }], error: null });
    await expect(repo.listForRide('l1')).resolves.toEqual([]);
  });

  it('throws when listForRide returns an error', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'db error' } });
    await expect(repo.listForRide('l1')).rejects.toThrow('db error');
  });

  it.each([
    ['approve', 'confirm_ride_booking'],
    ['decline', 'decline_ride_booking'],
    ['cancel', 'cancel_ride_booking'],
    ['complete', 'complete_ride_trip'],
  ] as const)('%s calls %s with the booking id', async (method, fn) => {
    const { rpc, repo } = repoWith({ data: {}, error: null });
    await repo[method]('h1');
    expect(rpc).toHaveBeenCalledWith(fn, { p_handoff_id: 'h1' });
  });

  it('keeps the server error code in the thrown message', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'owner_only' } });
    await expect(repo.decline('h1')).rejects.toThrow('owner_only');
  });

  describe('completeRide', () => {
    it('calls complete_ride_listing and returns count', async () => {
      const { rpc, repo } = repoWith({ data: 3, error: null });
      const completedCount = await repo.completeRide('l1');
      expect(rpc).toHaveBeenCalledWith('complete_ride_listing', { p_listing_id: 'l1' });
      expect(completedCount).toBe(3);
    });

    it('defaults to 0 when complete_ride_listing returns null', async () => {
      const { repo } = repoWith({ data: null, error: null });
      const completedCount = await repo.completeRide('l1');
      expect(completedCount).toBe(0);
    });

    it('throws when complete_ride_listing returns an error', async () => {
      const { repo } = repoWith({ data: null, error: { message: 'not_owner' } });
      await expect(repo.completeRide('l1')).rejects.toThrow('not_owner');
    });
  });

  describe('mapBookingRow edge cases', () => {
    it('handles nullable fields correctly', () => {
      const mapped = mapBookingRow({
        ...ROW,
        passenger_name: null as unknown as string,
        avatar_url: 'https://example.com/avatar.jpg',
        confirm_by: null as unknown as string,
        rated_by_me: null as unknown as boolean,
      });

      expect(mapped).toEqual({
        handoffId: 'h1',
        recipientId: 'u1',
        passengerName: '',
        avatarUrl: 'https://example.com/avatar.jpg',
        seats: 2,
        status: 'reserved',
        reservedAt: '2026-11-01T08:00:00Z',
        confirmBy: null,
        ratedByMe: false,
        requestedStopLabel: 'מחלף גלילות',
        cancelReason: null,
      });
    });
  });
});
