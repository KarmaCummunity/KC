// KC#870 — hide post, mute filters, feed impressions.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.legacy.types';

export type FeedMuteFilterKind = 'user' | 'category' | 'keyword' | 'world';

export interface FeedMuteFilterRow {
  filterId: string;
  filterKind: FeedMuteFilterKind;
  filterValue: string;
  createdAt: string;
}

export class SupabaseSocialFeedRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async hidePost(postId: string): Promise<void> {
    const { error } = await this.client.rpc('rpc_feed_hide_post' as never, { p_post_id: postId } as never);
    if (error) throw new Error(`hidePost: ${error.message}`);
  }

  async logImpressions(postIds: string[]): Promise<void> {
    if (postIds.length === 0) return;
    const { error } = await this.client.rpc(
      'rpc_feed_log_impressions' as never,
      { p_post_ids: postIds } as never,
    );
    if (error) throw new Error(`logImpressions: ${error.message}`);
  }

  async listMuteFilters(): Promise<FeedMuteFilterRow[]> {
    const { data, error } = await this.client.rpc('rpc_feed_list_mute_filters' as never);
    if (error) throw new Error(`listMuteFilters: ${error.message}`);
    return ((data ?? []) as Array<{ filter_id: string; filter_kind: string; filter_value: string; created_at: string }>).map((r) => ({
      filterId: r.filter_id,
      filterKind: r.filter_kind as FeedMuteFilterKind,
      filterValue: r.filter_value,
      createdAt: r.created_at,
    }));
  }

  async addMuteFilter(kind: FeedMuteFilterKind, value: string): Promise<void> {
    const { error } = await this.client.rpc(
      'rpc_feed_add_mute_filter' as never,
      { p_filter_kind: kind, p_filter_value: value } as never,
    );
    if (error) throw new Error(`addMuteFilter: ${error.message}`);
  }

  async removeMuteFilter(filterId: string): Promise<void> {
    const { error } = await this.client.rpc(
      'rpc_feed_remove_mute_filter' as never,
      { p_filter_id: filterId } as never,
    );
    if (error) throw new Error(`removeMuteFilter: ${error.message}`);
  }
}
