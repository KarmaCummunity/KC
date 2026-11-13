// FR-KNOW-004: knowledge seat bookings on the baseline slots and the generic handoff RPCs.
import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseKnowledgeBookingRepository } from '../SupabaseKnowledgeBookingRepository';

const SLOT = { id: 's1', starts_at: '2030-01-02T10:00:00+00:00', ends_at: '2030-01-02T11:00:00+00:00', capacity: 2, seats_taken: 1, seats_left: 1 };
const HANDOFF = {
  id: 'h1', post_id: 'p1', owner_id: 'giver', recipient_id: 'l1', status: 'reserved', cancel_reason: null,
  slot_starts_at: '2030-01-02T10:00:00Z', slot_ends_at: '2030-01-02T11:00:00Z', confirm_by: '2030-01-01T10:00:00Z',
  created_at: '2030-01-01T09:00:00Z',
};

const repoOf = (config: Parameters<typeof createFakeClient>[0]) => {
  const fake = createFakeClient(config);
  return { ...fake, repo: new SupabaseKnowledgeBookingRepository(fake.client) };
};

describe('SupabaseKnowledgeBookingRepository', () => {
  it("lists the slots with their places left and the viewer's own booking", async () => {
    const { repo, calls } = repoOf({
      userId: 'l1',
      rpc: { knowledge_slot_seats: ok([SLOT, { ...SLOT, id: 's2', starts_at: '2030-01-03T10:00:00Z', seats_left: 0 }]) },
      tables: { post_handoffs: ok([HANDOFF]) },
    });
    expect(await repo.listSlots('p1')).toEqual([
      { slotId: 's1', startsAt: SLOT.starts_at, endsAt: SLOT.ends_at, capacity: 2, seatsLeft: 1, myHandoffId: 'h1', myStatus: 'reserved' },
      { slotId: 's2', startsAt: '2030-01-03T10:00:00Z', endsAt: SLOT.ends_at, capacity: 2, seatsLeft: 0, myHandoffId: null, myStatus: null },
    ]);
    expect(callsTo(calls, 'knowledge_slot_seats')[0]?.args).toEqual({ p_post_id: 'p1' });
    expect(callsTo(calls, 'post_handoffs')[0]?.filters).toContainEqual(['eq', 'recipient_id', 'l1']);
  });

  it('lists the bookings of a post for the giver with the learner and the slot', async () => {
    const { repo } = repoOf({
      tables: {
        post_handoffs: ok([HANDOFF, { ...HANDOFF, id: 'h2', status: 'mystery' }]),
        post_knowledge_slots: ok([{ id: 's1', starts_at: SLOT.starts_at }]),
        users: ok([{ id: 'l1', display_name: 'Learner', avatar_url: null }]),
      },
    });
    expect(await repo.listBookings('p1')).toEqual([{
      handoffId: 'h1', slotId: 's1', startsAt: HANDOFF.slot_starts_at, endsAt: HANDOFF.slot_ends_at, status: 'reserved',
      cancelReason: null, confirmBy: HANDOFF.confirm_by, learnerId: 'l1', learnerName: 'Learner', learnerAvatarUrl: null,
    }]);
  });

  it('books a seat and moves a booking through the generic handoff RPCs', async () => {
    const { repo, calls } = repoOf({ rpc: { book_knowledge_seat: ok({ ...HANDOFF, id: 'h9' }) } });
    await expect(repo.bookSeat('s1')).resolves.toBe('h9');
    await repo.confirm('h9');
    await repo.decline('h9');
    await repo.completeSession('h9');
    expect(calls.map((c) => c.fn)).toEqual(['book_knowledge_seat', 'confirm_item_handoff', 'cancel_giving_handoff', 'mark_giving_handed_over']);
    expect(callsTo(calls, 'book_knowledge_seat')[0]?.args).toEqual({ p_slot_id: 's1' });
  });

  it('keeps the server reason and reports a missing function', async () => {
    const full = repoOf({ rpc: { book_knowledge_seat: fail('P0001', 'slots_exhausted') } });
    await expect(full.repo.bookSeat('s1')).rejects.toBeInstanceOf(BackendRuleError);
    await expect(full.repo.bookSeat('s1')).rejects.toThrow('slots_exhausted');
    const missing = repoOf({ rpc: { knowledge_slot_seats: fail('PGRST202', 'nope') } });
    await expect(missing.repo.listSlots('p1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
