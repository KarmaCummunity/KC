import type { KnowledgeSlot } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '../ports/IKnowledgeBookingRepository';

/** FR-KNOW-004: the slots a learner picks from, soonest first (the server orders them). */
export class ListKnowledgeSlotsUseCase {
  constructor(private readonly repo: IKnowledgeBookingRepository) {}

  execute(postId: string): Promise<KnowledgeSlot[]> {
    return this.repo.listSlots(postId);
  }
}
