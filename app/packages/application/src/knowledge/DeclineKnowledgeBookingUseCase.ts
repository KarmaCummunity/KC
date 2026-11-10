import type { IKnowledgeBookingRepository } from '../ports/IKnowledgeBookingRepository';
import { KnowledgeBookingError } from './bookingErrors';

/** FR-KNOW-004 AC2: the giver declines a waiting booking; its seat is freed. */
export class DeclineKnowledgeBookingUseCase {
  constructor(private readonly repo: IKnowledgeBookingRepository) {}

  execute(handoffId: string): Promise<void> {
    if (!handoffId) return Promise.reject(new KnowledgeBookingError('handoff_not_found'));
    return this.repo.decline(handoffId);
  }
}
