import { buildKnowledgeTopicTree, type KnowledgeTopicNode } from '@kc/domain';
import type { IKnowledgeTopicRepository } from '../ports/IKnowledgeTopicRepository';

/** FR-KNOW-001: the topic graph as the picker and the topic browser render it (merged topics left out). */
export class ListKnowledgeTopicsUseCase {
  constructor(private readonly repo: IKnowledgeTopicRepository) {}

  async execute(): Promise<KnowledgeTopicNode[]> {
    return buildKnowledgeTopicTree(await this.repo.listTopics());
  }
}
