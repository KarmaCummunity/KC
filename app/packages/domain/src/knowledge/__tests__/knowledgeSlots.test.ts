// FR-KNOW-003 / FR-KNOW-004 (#2034): knowledge kinds, slot rules and booking predicates.
import { describe, expect, it } from 'vitest';
import {
  canBookKnowledgeSlot,
  canCompleteKnowledgeSession,
  isKnowledgeBookingStatus,
  isKnowledgeSlotKind,
  KNOWLEDGE_POST_KIND_SLUGS,
  type KnowledgeSlot,
  knowledgeSlotsFromDetails,
  knowledgeSlotsProblem,
  knowledgeSlotsToDetails,
} from '../knowledgeSlots';

const NOW = new Date('2030-01-01T10:00:00Z');
const at = (iso: string) => iso;
const slot = (startsAt: string, endsAt: string) => ({ startsAt: at(startsAt), endsAt: at(endsAt) });

describe('knowledge kinds', () => {
  it('lists the six exchange kinds and marks the two that carry slots', () => {
    expect(KNOWLEDGE_POST_KIND_SLUGS).toHaveLength(6);
    expect(isKnowledgeSlotKind('lesson_offer')).toBe(true);
    expect(isKnowledgeSlotKind('consulting_hour')).toBe(true);
    expect(isKnowledgeSlotKind('mentoring_offer')).toBe(false);
    expect(isKnowledgeSlotKind(null)).toBe(false);
  });
});

describe('knowledgeSlotsProblem', () => {
  it('accepts future, non-overlapping slots of 15 minutes to 8 hours', () => {
    expect(
      knowledgeSlotsProblem(
        [slot('2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z'), slot('2030-01-01T12:00:00Z', '2030-01-01T12:15:00Z')],
        NOW,
      ),
    ).toBeNull();
  });

  it('refuses no slot, more than 20 and malformed or reversed times', () => {
    expect(knowledgeSlotsProblem([], NOW)).toBe('knowledge_slot_invalid');
    const many = Array.from({ length: 21 }, (_, i) =>
      slot(`2030-02-${String(i + 1).padStart(2, '0')}T10:00:00Z`, `2030-02-${String(i + 1).padStart(2, '0')}T11:00:00Z`),
    );
    expect(knowledgeSlotsProblem(many, NOW)).toBe('knowledge_slot_invalid');
    expect(knowledgeSlotsProblem([slot('soon', '2030-01-02T11:00:00Z')], NOW)).toBe('knowledge_slot_invalid');
    expect(knowledgeSlotsProblem([slot('2030-01-02T11:00:00Z', '2030-01-02T10:00:00Z')], NOW)).toBe(
      'knowledge_slot_invalid',
    );
  });

  it('refuses a session shorter than 15 minutes or longer than 8 hours', () => {
    expect(knowledgeSlotsProblem([slot('2030-01-02T10:00:00Z', '2030-01-02T10:14:00Z')], NOW)).toBe(
      'knowledge_slot_duration_invalid',
    );
    expect(knowledgeSlotsProblem([slot('2030-01-02T10:00:00Z', '2030-01-02T18:01:00Z')], NOW)).toBe(
      'knowledge_slot_duration_invalid',
    );
  });

  it('refuses a slot that already started', () => {
    expect(knowledgeSlotsProblem([slot('2030-01-01T09:30:00Z', '2030-01-01T10:30:00Z')], NOW)).toBe(
      'knowledge_slot_in_past',
    );
  });

  it('refuses overlapping slots but allows back-to-back ones', () => {
    expect(
      knowledgeSlotsProblem(
        [slot('2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z'), slot('2030-01-02T10:30:00Z', '2030-01-02T11:30:00Z')],
        NOW,
      ),
    ).toBe('knowledge_slots_overlap');
    expect(
      knowledgeSlotsProblem(
        [slot('2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z'), slot('2030-01-02T11:00:00Z', '2030-01-02T12:00:00Z')],
        NOW,
      ),
    ).toBeNull();
  });
});

describe('details mapping', () => {
  it('reads details.slots and writes them back sorted by start', () => {
    const details = {
      slots: [
        { starts_at: '2030-01-03T10:00:00Z', ends_at: '2030-01-03T11:00:00Z' },
        { starts_at: '2030-01-02T10:00:00Z', ends_at: '2030-01-02T11:00:00Z' },
      ],
    };
    const slots = knowledgeSlotsFromDetails(details);
    expect(slots).toHaveLength(2);
    expect(knowledgeSlotsToDetails(slots!)[0]).toEqual({
      starts_at: '2030-01-02T10:00:00Z',
      ends_at: '2030-01-02T11:00:00Z',
    });
  });

  it('returns null when the details hold no slot list', () => {
    expect(knowledgeSlotsFromDetails({ slot_starts_at: '2030-01-02T10:00:00Z' })).toBeNull();
  });

  it('turns a malformed item into empty times, which the rules then refuse', () => {
    const slots = knowledgeSlotsFromDetails({ slots: [null, { starts_at: 5 }] });
    expect(slots).toEqual([
      { startsAt: '', endsAt: '' },
      { startsAt: '', endsAt: '' },
    ]);
    expect(knowledgeSlotsProblem(slots!, NOW)).toBe('knowledge_slot_invalid');
  });
});

describe('booking predicates', () => {
  const open: KnowledgeSlot = {
    slotId: 's1',
    startsAt: '2030-01-02T10:00:00Z',
    endsAt: '2030-01-02T11:00:00Z',
    capacity: 2,
    seatsLeft: 1,
    myHandoffId: null,
    myStatus: null,
  };

  it('a slot takes a booking while it has a seat, has not started and the viewer holds none', () => {
    expect(canBookKnowledgeSlot(open, NOW)).toBe(true);
    expect(canBookKnowledgeSlot({ ...open, seatsLeft: 0 }, NOW)).toBe(false);
    expect(canBookKnowledgeSlot({ ...open, myStatus: 'reserved', myHandoffId: 'h' }, NOW)).toBe(false);
    expect(canBookKnowledgeSlot({ ...open, myStatus: 'cancelled', myHandoffId: 'h' }, NOW)).toBe(true);
    expect(canBookKnowledgeSlot(open, new Date('2030-01-02T10:00:00Z'))).toBe(false);
  });

  it('an approved session can be completed from 15 minutes before it starts, by either side', () => {
    const booking = { status: 'confirmed' as const, startsAt: '2030-01-01T10:15:00Z' };
    expect(canCompleteKnowledgeSession(booking, 'owner', NOW)).toBe(true);
    expect(canCompleteKnowledgeSession(booking, 'recipient', NOW)).toBe(true);
    expect(canCompleteKnowledgeSession({ ...booking, startsAt: '2030-01-01T10:16:00Z' }, 'owner', NOW)).toBe(false);
    expect(canCompleteKnowledgeSession({ ...booking, status: 'cancelled' }, 'owner', NOW)).toBe(false);
    expect(canCompleteKnowledgeSession({ status: 'confirmed', startsAt: null }, 'recipient', NOW)).toBe(true);
  });

  // Regression: the learner was offered "session held" on a request the giver had not answered,
  // and the server refused it (`handoff_not_confirmed`).
  it('a booking that still waits for the giver cannot be completed', () => {
    const waiting = { status: 'reserved' as const, startsAt: '2030-01-01T10:05:00Z' };
    expect(canCompleteKnowledgeSession(waiting, 'recipient', NOW)).toBe(false);
    expect(canCompleteKnowledgeSession(waiting, 'owner', NOW)).toBe(false);
    expect(canCompleteKnowledgeSession({ status: 'reserved', startsAt: null }, 'recipient', NOW)).toBe(false);
  });

  it('knows the booking statuses', () => {
    expect(isKnowledgeBookingStatus('handed_over')).toBe(true);
    expect(isKnowledgeBookingStatus('waitlisted')).toBe(false);
  });
});
