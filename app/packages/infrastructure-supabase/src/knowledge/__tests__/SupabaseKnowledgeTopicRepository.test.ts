// FR-KNOW-001: the topic graph is not in the baseline yet (M12), so every topic call degrades.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseKnowledgeTopicRepository } from '../SupabaseKnowledgeTopicRepository';

describe('SupabaseKnowledgeTopicRepository', () => {
  const repo = new SupabaseKnowledgeTopicRepository();

  it('reports the missing topic graph on every read', async () => {
    await expect(repo.listTopics()).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repo.resolveTopics('python')).rejects.toMatchObject({ object: 'rpc:resolve_knowledge_topics', kind: 'function' });
    await expect(repo.listFollowedTopicIds()).rejects.toMatchObject({ object: 'table:knowledge_topic_follows', kind: 'relation' });
  });

  it('reports the missing topic graph on every write', async () => {
    await expect(repo.proposeTopic({ slug: 'python', labelHe: 'x', labelEn: 'x' })).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repo.updateMyProposal('t1', { labelHe: 'x', labelEn: 'x' })).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repo.reviewTopic({ topicId: 't1', action: 'approve' })).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repo.setTopicFollowed('t1', true)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
