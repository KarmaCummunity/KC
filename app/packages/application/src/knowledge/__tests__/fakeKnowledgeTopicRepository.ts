import type { KnowledgeTopic, KnowledgeTopicMatch } from '@kc/domain';
import type {
  IKnowledgeTopicRepository,
  KnowledgeTopicLabels,
  ProposeKnowledgeTopicInput,
  ReviewKnowledgeTopicInput,
} from '../../ports/IKnowledgeTopicRepository';

export function makeTopic(overrides: Partial<KnowledgeTopic> = {}): KnowledgeTopic {
  return {
    topicId: 't-python',
    slug: 'python',
    parentId: 't-programming',
    labelHe: 'פייתון',
    labelEn: 'Python',
    descriptionHe: null,
    status: 'active',
    mergedIntoId: null,
    sortOrder: 1,
    ...overrides,
  };
}

/** In-memory port double that records the last call of every write. */
export class FakeKnowledgeTopicRepository implements IKnowledgeTopicRepository {
  topics: KnowledgeTopic[] = [];
  matches: KnowledgeTopicMatch[] = [];
  followed: string[] = [];
  lastProposal: ProposeKnowledgeTopicInput | null = null;
  lastReview: ReviewKnowledgeTopicInput | null = null;
  lastLabels: { topicId: string; labels: KnowledgeTopicLabels } | null = null;
  lastFollow: { topicId: string; followed: boolean } | null = null;
  resolveCalls: string[] = [];

  async listTopics(): Promise<KnowledgeTopic[]> {
    return this.topics;
  }

  async resolveTopics(text: string): Promise<KnowledgeTopicMatch[]> {
    this.resolveCalls.push(text);
    return this.matches;
  }

  async proposeTopic(input: ProposeKnowledgeTopicInput): Promise<KnowledgeTopic> {
    this.lastProposal = input;
    return makeTopic({ topicId: 't-new', slug: input.slug, labelHe: input.labelHe, labelEn: input.labelEn, status: 'proposed' });
  }

  async updateMyProposal(topicId: string, labels: KnowledgeTopicLabels): Promise<KnowledgeTopic> {
    this.lastLabels = { topicId, labels };
    return makeTopic({ topicId, ...labels, status: 'proposed' });
  }

  async reviewTopic(input: ReviewKnowledgeTopicInput): Promise<KnowledgeTopic> {
    this.lastReview = input;
    return makeTopic({ topicId: input.topicId, status: input.action === 'merge' ? 'merged' : 'active' });
  }

  async listFollowedTopicIds(): Promise<string[]> {
    return this.followed;
  }

  async setTopicFollowed(topicId: string, followed: boolean): Promise<void> {
    this.lastFollow = { topicId, followed };
  }
}
