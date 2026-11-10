// FR-KNOW-004 (#2034): knowledge booking use cases over an in-memory port double.
import { describe, expect, it } from 'vitest';
import type { KnowledgeBooking, KnowledgeSlot } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '../../ports/IKnowledgeBookingRepository';
import { BookKnowledgeSeatUseCase } from '../BookKnowledgeSeatUseCase';
import { CompleteKnowledgeSessionUseCase } from '../CompleteKnowledgeSessionUseCase';
import { ConfirmKnowledgeBookingUseCase } from '../ConfirmKnowledgeBookingUseCase';
import { DeclineKnowledgeBookingUseCase } from '../DeclineKnowledgeBookingUseCase';
import { ListKnowledgeBookingsUseCase } from '../ListKnowledgeBookingsUseCase';
import { ListKnowledgeSlotsUseCase } from '../ListKnowledgeSlotsUseCase';
import { KnowledgeBookingError } from '../bookingErrors';

const NOW = new Date('2030-01-01T10:00:00Z');

/** Records every call; reads return the configured rows. */
class FakeKnowledgeBookingRepository implements IKnowledgeBookingRepository {
  calls: Array<[string, string]> = [];
  slots: KnowledgeSlot[] = [];
  bookings: KnowledgeBooking[] = [];
  async listSlots(postId: string) {
    this.calls.push(['listSlots', postId]);
    return this.slots;
  }
  async bookSeat(slotId: string) {
    this.calls.push(['bookSeat', slotId]);
    return 'h-new';
  }
  async listBookings(postId: string) {
    this.calls.push(['listBookings', postId]);
    return this.bookings;
  }
  async confirm(handoffId: string) {
    this.calls.push(['confirm', handoffId]);
  }
  async decline(handoffId: string) {
    this.calls.push(['decline', handoffId]);
  }
  async completeSession(handoffId: string) {
    this.calls.push(['completeSession', handoffId]);
  }
}

const slot = (overrides: Partial<KnowledgeSlot> = {}): KnowledgeSlot => ({
  slotId: 's1',
  startsAt: '2030-01-02T10:00:00Z',
  endsAt: '2030-01-02T11:00:00Z',
  capacity: 2,
  seatsLeft: 1,
  myHandoffId: null,
  myStatus: null,
  ...overrides,
});

describe('BookKnowledgeSeatUseCase', () => {
  it('books an open seat', async () => {
    const repo = new FakeKnowledgeBookingRepository();
    await expect(new BookKnowledgeSeatUseCase(repo).execute(slot(), NOW)).resolves.toBe('h-new');
    expect(repo.calls).toEqual([['bookSeat', 's1']]);
  });

  it.each([
    ['slot_started', slot({ startsAt: '2030-01-01T09:59:00Z' })],
    ['already_booked', slot({ myStatus: 'confirmed', myHandoffId: 'h1' })],
    ['slots_exhausted', slot({ seatsLeft: 0 })],
    ['slot_not_found', slot({ slotId: '' })],
  ])('refuses with %s before reaching the server', async (code, input) => {
    const repo = new FakeKnowledgeBookingRepository();
    const result = new BookKnowledgeSeatUseCase(repo).execute(input, NOW);
    await expect(result).rejects.toBeInstanceOf(KnowledgeBookingError);
    await expect(result).rejects.toMatchObject({ code, message: code });
    expect(repo.calls).toEqual([]);
  });
});

describe('CompleteKnowledgeSessionUseCase', () => {
  it('completes a session that starts within 15 minutes', async () => {
    const repo = new FakeKnowledgeBookingRepository();
    await new CompleteKnowledgeSessionUseCase(repo).execute(
      { handoffId: 'h1', status: 'confirmed', startsAt: '2030-01-01T10:10:00Z' },
      NOW,
    );
    expect(repo.calls).toEqual([['completeSession', 'h1']]);
  });

  it('refuses a session that is still far ahead or no longer active', async () => {
    const repo = new FakeKnowledgeBookingRepository();
    const uc = new CompleteKnowledgeSessionUseCase(repo);
    await expect(uc.execute({ handoffId: 'h1', status: 'confirmed', startsAt: '2030-01-02T10:00:00Z' }, NOW)).rejects.toMatchObject({
      code: 'session_not_started',
    });
    await expect(uc.execute({ handoffId: 'h1', status: 'cancelled', startsAt: null }, NOW)).rejects.toMatchObject({
      code: 'session_not_started',
    });
    expect(repo.calls).toEqual([]);
  });
});

describe('giver answers and reads', () => {
  it('confirms and declines a booking by id', async () => {
    const repo = new FakeKnowledgeBookingRepository();
    await new ConfirmKnowledgeBookingUseCase(repo).execute('h1');
    await new DeclineKnowledgeBookingUseCase(repo).execute('h2');
    expect(repo.calls).toEqual([
      ['confirm', 'h1'],
      ['decline', 'h2'],
    ]);
  });

  it('refuses an empty booking id', async () => {
    const repo = new FakeKnowledgeBookingRepository();
    await expect(new ConfirmKnowledgeBookingUseCase(repo).execute('')).rejects.toMatchObject({ code: 'handoff_not_found' });
    await expect(new DeclineKnowledgeBookingUseCase(repo).execute('')).rejects.toMatchObject({ code: 'handoff_not_found' });
  });

  it('lists slots and bookings of a post', async () => {
    const repo = new FakeKnowledgeBookingRepository();
    repo.slots = [slot()];
    await expect(new ListKnowledgeSlotsUseCase(repo).execute('p1')).resolves.toHaveLength(1);
    await expect(new ListKnowledgeBookingsUseCase(repo).execute('p1')).resolves.toEqual([]);
    expect(repo.calls).toEqual([
      ['listSlots', 'p1'],
      ['listBookings', 'p1'],
    ]);
  });
});
