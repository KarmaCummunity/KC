import { KNOWLEDGE_TOPIC_LABEL_MAX, type KnowledgeTopic } from '@kc/domain';
import type { IKnowledgeTopicRepository, ReviewKnowledgeTopicInput } from '../ports/IKnowledgeTopicRepository';
import { KnowledgeTopicError } from './errors';

/**
 * FR-KNOW-001 AC5: an operator approves, rejects, renames or merges a topic. The shape of
 * each action is checked here; who may review is the database's decision (`forbidden`).
 */
export class ReviewKnowledgeTopicUseCase {
  constructor(private readonly repo: IKnowledgeTopicRepository) {}

  async execute(input: ReviewKnowledgeTopicInput): Promise<KnowledgeTopic> {
    const labelHe = input.labelHe?.trim() || null;
    const labelEn = input.labelEn?.trim() || null;
    if (input.action === 'merge') {
      if (!input.mergeIntoId || input.mergeIntoId === input.topicId) {
        throw new KnowledgeTopicError('merge_target_invalid', 'Merge needs a different target topic');
      }
    } else if (input.action === 'rename') {
      if (!labelHe && !labelEn) {
        throw new KnowledgeTopicError('action_invalid', 'Rename needs at least one new label');
      }
      if ((labelHe?.length ?? 0) > KNOWLEDGE_TOPIC_LABEL_MAX || (labelEn?.length ?? 0) > KNOWLEDGE_TOPIC_LABEL_MAX) {
        throw new KnowledgeTopicError('action_invalid', 'A topic label is at most 80 characters');
      }
    } else if (input.action !== 'approve' && input.action !== 'reject') {
      throw new KnowledgeTopicError('action_invalid', `Unknown review action: ${String(input.action)}`);
    }
    return this.repo.reviewTopic({
      topicId: input.topicId,
      action: input.action,
      mergeIntoId: input.action === 'merge' ? input.mergeIntoId : null,
      labelHe: input.action === 'rename' ? labelHe : null,
      labelEn: input.action === 'rename' ? labelEn : null,
    });
  }
}
