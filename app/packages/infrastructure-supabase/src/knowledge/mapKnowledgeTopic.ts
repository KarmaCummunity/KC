import type { KnowledgeTopic, KnowledgeTopicMatch, KnowledgeTopicStatus } from '@kc/domain';
import type { Database } from '../database.legacy.types';

export type KnowledgeTopicRow = Database['public']['Tables']['knowledge_topics']['Row'];
type ResolveRow = Database['public']['Functions']['resolve_knowledge_topics']['Returns'][number];

/** The columns `SupabaseKnowledgeTopicRepository` reads; `created_by` and `approved_by` stay server-side. */
export const KNOWLEDGE_TOPIC_COLUMNS =
  'topic_id, slug, parent_id, label_he, label_en, description_he, status, merged_into_id, sort_order';

export type KnowledgeTopicSelectRow = Pick<
  KnowledgeTopicRow,
  'topic_id' | 'slug' | 'parent_id' | 'label_he' | 'label_en' | 'description_he' | 'status' | 'merged_into_id' | 'sort_order'
>;

/** FR-KNOW-001: a `knowledge_topics` row as the domain sees it. */
export function mapKnowledgeTopic(row: KnowledgeTopicSelectRow): KnowledgeTopic {
  return {
    topicId: row.topic_id,
    slug: row.slug,
    parentId: row.parent_id,
    labelHe: row.label_he,
    labelEn: row.label_en,
    descriptionHe: row.description_he,
    status: row.status as KnowledgeTopicStatus,
    mergedIntoId: row.merged_into_id,
    sortOrder: row.sort_order,
  };
}

/** One row of `resolve_knowledge_topics`. */
export function mapKnowledgeTopicMatch(row: ResolveRow): KnowledgeTopicMatch {
  return {
    topicId: row.topic_id,
    slug: row.slug,
    matchedSlug: row.matched_slug,
    via: row.via === 'descendant' ? 'descendant' : 'self',
  };
}
