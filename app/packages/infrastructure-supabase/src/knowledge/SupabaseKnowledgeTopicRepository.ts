import type { KnowledgeTopic, KnowledgeTopicMatch } from '@kc/domain';
import { BackendUnavailableError } from '@kc/domain';
import type {
  IKnowledgeTopicRepository,
  KnowledgeTopicLabels,
  ProposeKnowledgeTopicInput,
  ReviewKnowledgeTopicInput,
} from '@kc/application';

/** Every topic call reports the missing topic graph (docs/db/app-migration-map.md M12). */
const unavailable = <T>(object: string, kind: 'function' | 'relation'): Promise<T> =>
  Promise.reject(new BackendUnavailableError(object, kind));

/**
 * FR-KNOW-001 topic graph (topics, aliases, follows, proposals, review). The production baseline
 * has no topic graph yet (M12: the knowledge world opens behind `world_knowledge_enabled`), so
 * every method rejects with `BackendUnavailableError` and a topic picker shows its empty state
 * (degrade rule, docs/db/app-migration-playbook.md § 3). It calls no backend object until the
 * graph is built.
 */
export class SupabaseKnowledgeTopicRepository implements IKnowledgeTopicRepository {
  listTopics(): Promise<KnowledgeTopic[]> {
    return unavailable('table:knowledge_topics', 'relation');
  }

  resolveTopics(_text: string): Promise<KnowledgeTopicMatch[]> {
    return unavailable('rpc:resolve_knowledge_topics', 'function');
  }

  proposeTopic(_input: ProposeKnowledgeTopicInput): Promise<KnowledgeTopic> {
    return unavailable('rpc:propose_knowledge_topic', 'function');
  }

  updateMyProposal(_topicId: string, _labels: KnowledgeTopicLabels): Promise<KnowledgeTopic> {
    return unavailable('rpc:update_my_proposed_knowledge_topic', 'function');
  }

  reviewTopic(_input: ReviewKnowledgeTopicInput): Promise<KnowledgeTopic> {
    return unavailable('rpc:review_knowledge_topic', 'function');
  }

  listFollowedTopicIds(): Promise<string[]> {
    return unavailable('table:knowledge_topic_follows', 'relation');
  }

  setTopicFollowed(_topicId: string, _followed: boolean): Promise<void> {
    return unavailable('table:knowledge_topic_follows', 'relation');
  }
}
