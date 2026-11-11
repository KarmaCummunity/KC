import type { SupabaseClient } from '@supabase/supabase-js';
import type { KnowledgeTopic, KnowledgeTopicMatch } from '@kc/domain';
import { KnowledgeTopicError, knowledgeTopicErrorFromDb } from '@kc/application';
import type {
  IKnowledgeTopicRepository,
  KnowledgeTopicLabels,
  ProposeKnowledgeTopicInput,
  ReviewKnowledgeTopicInput,
} from '@kc/application';
import type { Database } from '../database.legacy.types';
import { KNOWLEDGE_TOPIC_COLUMNS, mapKnowledgeTopic, mapKnowledgeTopicMatch } from './mapKnowledgeTopic';

type Client = SupabaseClient<Database>;

/**
 * FR-KNOW-001 adapter over migration `0570`: the topic tree and aliases are plain reads
 * (RLS lets everyone select), every write is an RPC whose error names map to
 * `KnowledgeTopicError` codes, and follows are the member's own rows.
 */
export class SupabaseKnowledgeTopicRepository implements IKnowledgeTopicRepository {
  constructor(private readonly client: Client) {}

  async listTopics(): Promise<KnowledgeTopic[]> {
    const { data, error } = await this.client
      .from('knowledge_topics')
      .select(KNOWLEDGE_TOPIC_COLUMNS)
      .order('sort_order')
      .order('label_he');
    if (error) throw knowledgeTopicErrorFromDb(error);
    return (data ?? []).map(mapKnowledgeTopic);
  }

  async resolveTopics(text: string): Promise<KnowledgeTopicMatch[]> {
    const { data, error } = await this.client.rpc('resolve_knowledge_topics', { p_text: text });
    if (error) throw knowledgeTopicErrorFromDb(error);
    return (data ?? []).map(mapKnowledgeTopicMatch);
  }

  async proposeTopic(input: ProposeKnowledgeTopicInput): Promise<KnowledgeTopic> {
    const { data, error } = await this.client.rpc('propose_knowledge_topic', {
      p_slug: input.slug,
      p_label_he: input.labelHe,
      p_label_en: input.labelEn,
      p_parent_slug: input.parentSlug ?? undefined,
      p_description_he: input.descriptionHe ?? undefined,
    });
    if (error || !data) throw knowledgeTopicErrorFromDb(error);
    return mapKnowledgeTopic(data);
  }

  async updateMyProposal(topicId: string, labels: KnowledgeTopicLabels): Promise<KnowledgeTopic> {
    const { data, error } = await this.client.rpc('update_my_proposed_knowledge_topic', {
      p_topic_id: topicId,
      p_label_he: labels.labelHe,
      p_label_en: labels.labelEn,
      p_description_he: labels.descriptionHe ?? undefined,
    });
    if (error || !data) throw knowledgeTopicErrorFromDb(error);
    return mapKnowledgeTopic(data);
  }

  async reviewTopic(input: ReviewKnowledgeTopicInput): Promise<KnowledgeTopic> {
    const { data, error } = await this.client.rpc('review_knowledge_topic', {
      p_topic_id: input.topicId,
      p_action: input.action,
      p_merge_into_id: input.mergeIntoId ?? undefined,
      p_label_he: input.labelHe ?? undefined,
      p_label_en: input.labelEn ?? undefined,
    });
    if (error || !data) throw knowledgeTopicErrorFromDb(error);
    return mapKnowledgeTopic(data);
  }

  async listFollowedTopicIds(): Promise<string[]> {
    const { data, error } = await this.client.from('knowledge_topic_follows').select('topic_id');
    if (error) throw knowledgeTopicErrorFromDb(error);
    return (data ?? []).map((row) => row.topic_id);
  }

  async setTopicFollowed(topicId: string, followed: boolean): Promise<void> {
    const userId = (await this.client.auth.getUser()).data.user?.id ?? null;
    if (!userId) throw new KnowledgeTopicError('unauthorized', 'Following a topic needs a signed-in member');
    const table = this.client.from('knowledge_topic_follows');
    const { error } = followed
      ? await table.upsert({ user_id: userId, topic_id: topicId }, { onConflict: 'user_id,topic_id', ignoreDuplicates: true })
      : await table.delete().eq('user_id', userId).eq('topic_id', topicId);
    if (error) throw knowledgeTopicErrorFromDb(error);
  }
}
