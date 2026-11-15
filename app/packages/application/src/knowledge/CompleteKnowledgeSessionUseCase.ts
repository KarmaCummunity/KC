import { canCompleteKnowledgeSession, type GivingHandoffParty, type KnowledgeBooking } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '../ports/IKnowledgeBookingRepository';
import { KnowledgeBookingError } from './bookingErrors';

/**
 * FR-KNOW-004 AC3: either side marks an approved session done, from 15 minutes before it
 * starts; `party` is the caller's side of the booking. The server grants the karma (giver per
 * half hour, capped at 80 a day; learner 5), once.
 */
export class CompleteKnowledgeSessionUseCase {
  constructor(private readonly repo: IKnowledgeBookingRepository) {}

  execute(
    booking: Pick<KnowledgeBooking, 'handoffId' | 'status' | 'startsAt'>,
    party: GivingHandoffParty,
    now: Date = new Date(),
  ): Promise<void> {
    if (!booking.handoffId) return Promise.reject(new KnowledgeBookingError('handoff_not_found'));
    if (!canCompleteKnowledgeSession(booking, party, now)) {
      return Promise.reject(new KnowledgeBookingError('session_not_started'));
    }
    return this.repo.completeSession(booking.handoffId);
  }
}
