import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseRideBookingRepository } from '../SupabaseRideBookingRepository';

const HANDOFF = {
  id: 'h1', post_id: 'p1', owner_id: 'driver', recipient_id: 'pass', machine_id: 'ride_booking', status: 'reserved',
  cancel_reason: null, seats: 2, confirm_by: '2026-01-01T10:00:00Z', created_at: '2026-01-01T00:00:00Z',
  requested_meeting_point: { kind: 'city', id: 'IL-001', label: 'Tel Aviv' },
};

describe('SupabaseRideBookingRepository', () => {
  it('books seats with the baseline argument names and returns the booking id', async () => {
    const { client, calls } = createFakeClient({ rpc: { book_ride_seat: ok(HANDOFF) } });
    const id = await new SupabaseRideBookingRepository(client).bookSeat('p1', 2, { kind: 'city', id: 'IL-001', label: 'Tel Aviv' });
    expect(id).toBe('h1');
    expect(callsTo(calls, 'book_ride_seat')[0]?.args).toEqual({
      p_post_id: 'p1', p_seats: 2, p_requested_meeting_point: { kind: 'city', id: 'IL-001', label: 'Tel Aviv' },
    });
  });

  it('lists the bookings with the passenger name, the requested stop and whether the driver rated', async () => {
    const { client } = createFakeClient({
      userId: 'driver',
      tables: {
        post_handoffs: ok([HANDOFF, { ...HANDOFF, id: 'h2', status: 'weird' }]),
        users: ok([{ id: 'pass', display_name: 'Dana', avatar_url: null }]),
        post_ratings: ok([{ handoff_id: 'h1' }]),
      },
    });
    const bookings = await new SupabaseRideBookingRepository(client).listForRide('p1');
    expect(bookings).toEqual([
      {
        handoffId: 'h1', recipientId: 'pass', passengerName: 'Dana', avatarUrl: null, seats: 2, status: 'reserved',
        reservedAt: '2026-01-01T00:00:00Z', confirmBy: '2026-01-01T10:00:00Z', ratedByMe: true,
        requestedStopLabel: 'Tel Aviv', cancelReason: null,
      },
    ]);
  });

  it('maps decline and cancel to the one cancel RPC and approve to confirm', async () => {
    const { client, calls } = createFakeClient({ rpc: { cancel_ride_booking: ok(HANDOFF), confirm_ride_booking: ok(HANDOFF) } });
    const repo = new SupabaseRideBookingRepository(client);
    await repo.decline('h1');
    await repo.cancel('h1');
    await repo.approve('h1');
    expect(calls.map((call) => call.fn)).toEqual(['cancel_ride_booking', 'cancel_ride_booking', 'confirm_ride_booking']);
  });

  it('completes the whole ride and reports how many bookings finished', async () => {
    const { client } = createFakeClient({ rpc: { complete_ride: ok(3) } });
    expect(await new SupabaseRideBookingRepository(client).completeRide('p1')).toBe(3);
  });

  it('surfaces a stable refusal as a BackendRuleError', async () => {
    const { client } = createFakeClient({ rpc: { book_ride_seat: fail('P0001', 'seats_exhausted') } });
    await expect(new SupabaseRideBookingRepository(client).bookSeat('p1', 9)).rejects.toMatchObject({
      constructor: BackendRuleError,
      reason: 'seats_exhausted',
    });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({ rpc: { complete_ride_trip: fail('PGRST202', 'not found') } });
    await expect(new SupabaseRideBookingRepository(client).complete('h1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
