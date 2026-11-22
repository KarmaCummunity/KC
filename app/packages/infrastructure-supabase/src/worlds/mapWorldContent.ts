import type {
  ExternalBodyOption,
  KnowledgeShelfLink,
  KnowledgeShelfSlug,
  KnowledgeTopic,
  KnowledgeTopicStatus,
  WorldLink,
} from '@kc/domain';
import type { Database } from '../database.types';

type Tables = Database['public']['Tables'];

// The columns each read names. The tables carry no hidden column, but naming them keeps the
// payload to what the screen shows and survives a later column-level grant.
export const WORLD_LINK_COLUMNS = 'id, from_world_slug, to_world_slug, link_slug, label_he, label_en, description';
export const EXTERNAL_BODY_COLUMNS = 'id, slug, world_slug, label_he, label_en, body_type, contact_url';
export const WORLD_TOPIC_COLUMNS =
  'id, slug, parent_id, label_he, label_en, description_he, status, merged_into_id, sort_order';
export const KNOWLEDGE_SHELF_LINK_COLUMNS =
  'id, shelf_slug, link_slug, label_he, label_en, url';

export type WorldLinkRow = Pick<
  Tables['world_links']['Row'],
  'id' | 'from_world_slug' | 'to_world_slug' | 'link_slug' | 'label_he' | 'label_en' | 'description'
>;
export type ExternalBodyRow = Pick<
  Tables['external_bodies']['Row'],
  'id' | 'slug' | 'world_slug' | 'label_he' | 'label_en' | 'body_type' | 'contact_url'
>;
export type WorldTopicRow = Pick<
  Tables['knowledge_topics']['Row'],
  'id' | 'slug' | 'parent_id' | 'label_he' | 'label_en' | 'description_he' | 'status' | 'merged_into_id' | 'sort_order'
>;
export type KnowledgeShelfLinkRow = Pick<
  Tables['knowledge_shelf_links']['Row'],
  'id' | 'shelf_slug' | 'link_slug' | 'label_he' | 'label_en' | 'url'
>;

/** A `world_links` row as the domain sees it. */
export function mapWorldLink(row: WorldLinkRow): WorldLink {
  return {
    linkId: row.id,
    fromWorldSlug: row.from_world_slug,
    toWorldSlug: row.to_world_slug,
    linkSlug: row.link_slug,
    labelHe: row.label_he,
    labelEn: row.label_en,
    description: row.description,
  };
}

/** An `external_bodies` row as the domain sees it. */
export function mapExternalBody(row: ExternalBodyRow): ExternalBodyOption {
  return {
    bodyId: row.id,
    slug: row.slug,
    worldSlug: row.world_slug,
    labelHe: row.label_he,
    labelEn: row.label_en,
    bodyType: row.body_type,
    contactUrl: row.contact_url,
  };
}

/** A `knowledge_topics` row of the baseline (`id`, not the older `topic_id`) as the domain sees it. */
export function mapWorldTopic(row: WorldTopicRow): KnowledgeTopic {
  return {
    topicId: row.id,
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

/** A `knowledge_shelf_links` row as the domain sees it (FR-KNOW-012 AC2). */
export function mapKnowledgeShelfLink(row: KnowledgeShelfLinkRow): KnowledgeShelfLink {
  return {
    linkId: row.id,
    shelfSlug: row.shelf_slug as KnowledgeShelfSlug,
    linkSlug: row.link_slug,
    labelHe: row.label_he,
    labelEn: row.label_en,
    url: row.url,
  };
}
