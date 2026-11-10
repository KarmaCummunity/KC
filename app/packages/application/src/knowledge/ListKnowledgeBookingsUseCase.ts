import type { KnowledgeBooking } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '../ports/IKnowledgeBookingRepository';

/** FR-KNOW-004 AC2: the giver's panel — every booking of their post (the server checks ownership). */
export class ListKnowledgeBookingsUseCase {
  constructor(private readonly repo: IKnowledgeBookingRepository) {}

  execute(postId: string): Promise<KnowledgeBooking[]> {
    return this.repo.listBookings(postId);
  }
}
