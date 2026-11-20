import type { KnowledgeSlotSeries, KnowledgeSlotSeriesStatus } from '@kc/domain';
import type { IKnowledgeSlotSeriesRepository } from '../ports/IKnowledgeSlotSeriesRepository';

/** FR-KNOW-004 AC1: the schedule of a recurring lesson offer, for its detail screen. */
export class GetKnowledgeSlotSeriesUseCase {
  constructor(private readonly repo: IKnowledgeSlotSeriesRepository) {}

  execute(postId: string): Promise<KnowledgeSlotSeries | null> {
    return this.repo.getForPost(postId);
  }
}

/** FR-KNOW-004 AC1: the giver pauses, resumes or ends the series; the server enforces the machine. */
export class SetKnowledgeSlotSeriesStatusUseCase {
  constructor(private readonly repo: IKnowledgeSlotSeriesRepository) {}

  execute(postId: string, status: KnowledgeSlotSeriesStatus): Promise<void> {
    return this.repo.setStatus(postId, status);
  }
}
