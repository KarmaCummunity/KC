import type { IKnowledgeTopicRepository } from '../ports/IKnowledgeTopicRepository';
import { KnowledgeTopicError } from './errors';

export interface FollowKnowledgeTopicInput {
  readonly topicId: string;
  readonly followed: boolean;
}

/** FR-KNOW-008 AC5 groundwork: follow or unfollow a topic ("new on a topic you follow", D10). */
export class FollowKnowledgeTopicUseCase {
  constructor(private readonly repo: IKnowledgeTopicRepository) {}

  async execute(input: FollowKnowledgeTopicInput): Promise<void> {
    if (!input.topicId) throw new KnowledgeTopicError('not_found', 'A topic id is required');
    await this.repo.setTopicFollowed(input.topicId, input.followed);
  }
}
