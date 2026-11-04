import { type KnowledgeTopic, validateKnowledgeTopicProposal } from '@kc/domain';
import type { IKnowledgeTopicRepository, ProposeKnowledgeTopicInput } from '../ports/IKnowledgeTopicRepository';

/**
 * FR-KNOW-001 AC5: a member proposes a topic from the create / contribute form. The domain
 * rules (kebab slug, label lengths) fail here with a `ValidationError` naming the field;
 * uniqueness, the parent and the ten-open-proposals cap are the database's call.
 */
export class ProposeKnowledgeTopicUseCase {
  constructor(private readonly repo: IKnowledgeTopicRepository) {}

  async execute(input: ProposeKnowledgeTopicInput): Promise<KnowledgeTopic> {
    const proposal = validateKnowledgeTopicProposal(input);
    return this.repo.proposeTopic({
      slug: proposal.slug,
      labelHe: proposal.labelHe,
      labelEn: proposal.labelEn,
      parentSlug: proposal.parentSlug ?? null,
      descriptionHe: proposal.descriptionHe ?? null,
    });
  }
}
