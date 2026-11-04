import { type KnowledgeTopicMatch, normalizeKnowledgeText } from '@kc/domain';
import type { IKnowledgeTopicRepository } from '../ports/IKnowledgeTopicRepository';

/**
 * FR-KNOW-001 AC4: the topics a free-text query names, for search and the form's
 * auto-suggest. Text that normalizes to nothing never reaches the database.
 */
export class ResolveKnowledgeTopicsUseCase {
  constructor(private readonly repo: IKnowledgeTopicRepository) {}

  async execute(text: string): Promise<KnowledgeTopicMatch[]> {
    if (normalizeKnowledgeText(text) === '') return [];
    return this.repo.resolveTopics(text.trim());
  }
}
