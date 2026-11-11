import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorldContent } from '@kc/domain';
import type { IWorldContentRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import {
  EXTERNAL_BODY_COLUMNS,
  WORLD_LINK_COLUMNS,
  WORLD_TOPIC_COLUMNS,
  mapExternalBody,
  mapWorldLink,
  mapWorldTopic,
} from './mapWorldContent';

type Client = SupabaseClient<Database>;

/**
 * Links and knowledge of a giving world (migration 0021). Three plain reads in parallel: row
 * level security already hides what is not live, so the filters below only narrow to the world
 * and keep a platform admin's view of the member screens identical to a member's.
 */
export class SupabaseWorldContentRepository implements IWorldContentRepository {
  constructor(private readonly client: Client) {}

  async getWorldContent(worldSlug: string): Promise<WorldContent> {
    const [links, bodies, topics] = await Promise.all([
      this.client
        .from('world_links')
        .select(WORLD_LINK_COLUMNS)
        .eq('from_world_slug', worldSlug)
        .eq('is_active', true)
        .order('sort_order')
        .order('link_slug'),
      this.client
        .from('external_bodies')
        .select(EXTERNAL_BODY_COLUMNS)
        .eq('world_slug', worldSlug)
        .eq('is_active', true)
        .order('sort_order')
        .order('slug'),
      this.client
        .from('knowledge_topics')
        .select(WORLD_TOPIC_COLUMNS)
        .eq('world_slug', worldSlug)
        .eq('status', 'active')
        .order('sort_order')
        .order('slug'),
    ]);
    return {
      worldSlug,
      links: (unwrapCall('table:world_links', links) ?? []).map(mapWorldLink),
      externalBodies: (unwrapCall('table:external_bodies', bodies) ?? []).map(mapExternalBody),
      topics: (unwrapCall('table:knowledge_topics', topics) ?? []).map(mapWorldTopic),
    };
  }
}
