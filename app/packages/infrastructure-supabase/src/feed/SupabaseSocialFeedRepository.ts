// KC#870 — hide a post, mute filters, feed impressions: the caller's own rows in `feed_hides`,
// `feed_mute_filters` and `feed_impressions` (row-level security keeps each member to their own).

import type { SupabaseClient } from '@supabase/supabase-js';
import { PostError } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';

/** What a mute hides. The baseline table knows these three; there is no per-category mute. */
export type FeedMuteFilterKind = 'user' | 'keyword' | 'world';

export interface FeedMuteFilterRow {
  filterId: string;
  filterKind: FeedMuteFilterKind;
  filterValue: string;
  createdAt: string;
}

type MuteInsert = Database['public']['Tables']['feed_mute_filters']['Insert'];

/** The row for a mute and the unique key a duplicate would break; a keyword is stored trimmed, lower-case. */
function muteRow(userId: string, kind: FeedMuteFilterKind, value: string): { row: MuteInsert; conflict: string } {
  if (kind === 'user') {
    return { row: { user_id: userId, filter_kind: kind, muted_user_id: value }, conflict: 'user_id,muted_user_id' };
  }
  if (kind === 'world') {
    return { row: { user_id: userId, filter_kind: kind, world_slug: value }, conflict: 'user_id,world_slug' };
  }
  return {
    row: { user_id: userId, filter_kind: kind, keyword: value.trim().toLowerCase() },
    conflict: 'user_id,keyword',
  };
}

export class SupabaseSocialFeedRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  private async requireUserId(): Promise<string> {
    const userId = await sessionUserId(this.client);
    if (!userId) throw new PostError('forbidden', 'feed: not signed in');
    return userId;
  }

  /** Hides a post from the caller's feed. Hiding it twice is not an error. */
  async hidePost(postId: string): Promise<void> {
    const userId = await this.requireUserId();
    unwrapCall(
      'table:feed_hides',
      await this.client
        .from('feed_hides')
        .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true }),
    );
  }

  /** Records that the caller saw these posts; the table fills the member and the time. */
  async logImpressions(postIds: string[]): Promise<void> {
    if (postIds.length === 0) return;
    unwrapCall(
      'table:feed_impressions',
      await this.client.from('feed_impressions').insert(postIds.map((postId) => ({ post_id: postId }))),
    );
  }

  async listMuteFilters(): Promise<FeedMuteFilterRow[]> {
    const rows = unwrapCall(
      'table:feed_mute_filters',
      await this.client
        .from('feed_mute_filters')
        .select('id, filter_kind, muted_user_id, world_slug, keyword, created_at')
        .order('created_at'),
    );
    return (rows ?? []).map((row) => ({
      filterId: row.id,
      filterKind: row.filter_kind as FeedMuteFilterKind,
      filterValue: row.muted_user_id ?? row.world_slug ?? row.keyword ?? '',
      createdAt: row.created_at,
    }));
  }

  /** Adds a mute. Muting the same thing twice is not an error. */
  async addMuteFilter(kind: FeedMuteFilterKind, value: string): Promise<void> {
    const { row, conflict } = muteRow(await this.requireUserId(), kind, value);
    unwrapCall(
      'table:feed_mute_filters',
      await this.client.from('feed_mute_filters').upsert(row, { onConflict: conflict, ignoreDuplicates: true }),
    );
  }

  async removeMuteFilter(filterId: string): Promise<void> {
    unwrapCall('table:feed_mute_filters', await this.client.from('feed_mute_filters').delete().eq('id', filterId));
  }
}
