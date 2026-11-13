import { canBookKnowledgeSlot, isGivingHandoffLive, type KnowledgeSlot } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '../ports/IKnowledgeBookingRepository';
import { KnowledgeBookingError } from './bookingErrors';

/**
 * FR-KNOW-004 AC2: a learner books one seat on a slot. With the slot as last listed, a booking
 * the server would refuse (started, full, already held) fails here with the same code; the server
 * still decides, since seats can go between listing and booking.
 */
export class BookKnowledgeSeatUseCase {
  constructor(private readonly repo: IKnowledgeBookingRepository) {}

  execute(slot: KnowledgeSlot, now: Date = new Date()): Promise<string> {
    if (!slot.slotId) return Promise.reject(new KnowledgeBookingError('slot_not_found'));
    if (!canBookKnowledgeSlot(slot, now)) {
      return Promise.reject(new KnowledgeBookingError(refusalOf(slot, now)));
    }
    return this.repo.bookSeat(slot.slotId);
  }
}

/** Why `canBookKnowledgeSlot` said no, in the server's order of checks. */
function refusalOf(slot: KnowledgeSlot, now: Date) {
  if (Date.parse(slot.startsAt) <= now.getTime()) return 'slot_started' as const;
  if (isGivingHandoffLive(slot.myStatus)) return 'already_booked' as const;
  return 'slots_exhausted' as const;
}
