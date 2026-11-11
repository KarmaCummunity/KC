// FR-KNOW-004 (#2034): the Supabase adapter of knowledge seat bookings, over a recording RPC fake.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { mapBookingRow, mapSlotRow, SupabaseKnowledgeBookingRepository } from '../SupabaseKnowledgeBookingRepository';

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(result: Result) {
  const calls: Array<[string, unknown]> = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const slotRow = {
  slot_id: 's1',
  starts_at: '2030-01-02T10:00:00Z',
  ends_at: '2030-01-02T11:00:00Z',
  capacity: 2,
  seats_left: 1,
  my_handoff_id: null as unknown as string,
  my_status: null as unknown as string,
};

const bookingRow = {
  handoff_id: 'h1',
  slot_id: 's1',
  starts_at: '2030-01-02T10:00:00Z',
  ends_at: '2030-01-02T11:00:00Z',
  status: 'reserved',
  cancel_reason: null as unknown as string,
  confirm_by: '2030-01-02T09:00:00Z',
  learner_id: 'u2',
  learner_name: 'Dana',
  learner_avatar: null as unknown as string,
};

describe('SupabaseKnowledgeBookingRepository', () => {
  it('lists the slots of a post and maps them', async () => {
    const { client, calls } = fakeClient({ data: [slotRow], error: null });
    const slots = await new SupabaseKnowledgeBookingRepository(client).listSlots('p1');
    expect(calls).toEqual([['list_knowledge_slots', { p_post_id: 'p1' }]]);
    expect(slots).toEqual([
      { slotId: 's1', startsAt: slotRow.starts_at, endsAt: slotRow.ends_at, capacity: 2, seatsLeft: 1, myHandoffId: null, myStatus: null },
    ]);
  });

  it('books a seat and returns the booking id', async () => {
    const { client, calls } = fakeClient({ data: { handoff_id: 'h9' }, error: null });
    await expect(new SupabaseKnowledgeBookingRepository(client).bookSeat('s1')).resolves.toBe('h9');
    expect(calls).toEqual([['book_knowledge_seat', { p_slot_id: 's1' }]]);
  });

  it('keeps the server error code as the message', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'slots_exhausted' } });
    await expect(new SupabaseKnowledgeBookingRepository(client).bookSeat('s1')).rejects.toThrow('slots_exhausted');
  });

  it('answers and completes through the matching RPCs', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    const repo = new SupabaseKnowledgeBookingRepository(client);
    await repo.confirm('h1');
    await repo.decline('h2');
    await repo.completeSession('h3');
    expect(calls).toEqual([
      ['confirm_knowledge_booking', { p_handoff_id: 'h1' }],
      ['decline_knowledge_booking', { p_handoff_id: 'h2' }],
      ['complete_knowledge_session', { p_handoff_id: 'h3' }],
    ]);
  });

  it('lists the bookings of a post and drops a row with an unknown status', async () => {
    const { client } = fakeClient({ data: [bookingRow, { ...bookingRow, handoff_id: 'h2', status: 'teleported' }], error: null });
    const bookings = await new SupabaseKnowledgeBookingRepository(client).listBookings('p1');
    expect(bookings.map((b) => b.handoffId)).toEqual(['h1']);
  });
});

describe('row mappers', () => {
  it('never reports negative seats and keeps a known own status', () => {
    expect(mapSlotRow({ ...slotRow, seats_left: -1, my_status: 'confirmed', my_handoff_id: 'h1' })).toMatchObject({
      seatsLeft: 0,
      myStatus: 'confirmed',
      myHandoffId: 'h1',
    });
  });

  it('maps a booking row with defaults for missing names', () => {
    expect(mapBookingRow({ ...bookingRow, learner_name: null as unknown as string })).toMatchObject({
      learnerName: '',
      learnerAvatarUrl: null,
      status: 'reserved',
    });
  });
});
