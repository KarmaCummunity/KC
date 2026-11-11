// feedQuery — extracted from SupabasePostRepository.getFeed so the repository
// stays under its file-size cap (TD-50). The distance-aware path replaces
// this select-builder logic in P1.2 Commit 2 via the feed_ranked_ids RPC.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostFeedFilter } from '@kc/application';
import type { Database } from '../database.legacy.types';
import { FEED_CARD_SELECT } from './mapPostRow';
import { decodeCursor } from './cursor';
import { feedTextSearchOrClause } from './applyFeedTextSearch';

// Return type is inferred so the Supabase PostgrestFilterBuilder<...> with all
// its nested generics doesn't need to be named here.
/**
 * `feed_visible_posts` (0417) = posts minus the viewer's hides and mutes (#985); same columns
 * and relationships, so signed-in viewers read it instead of `posts`. Guests use `posts`.
 */
export type FeedSource = 'posts' | 'feed_visible_posts';

export function buildFeedQuery(
  client: SupabaseClient<Database>,
  filter: PostFeedFilter,
  cursor: string | undefined,
  pageLimit: number,
  source: FeedSource = 'posts',
) {
  // The view shares posts' row shape; type it as posts for the select-string parser.
  let q = client.from(source as 'posts').select(FEED_CARD_SELECT);

  // A post that exists for a listing kept out of the main feed (posts.feed_hidden, 0557) is
  // never listed; the view filters it too, the guests' `posts` source needs it here.
  q = q.eq('feed_hidden', false);

  // statusFilter: 'open' (default), 'closed' (delivered only), 'all'.
  const status = filter.statusFilter ?? 'open';
  if (status === 'all') {
    q = q.in('status', ['open', 'closed_delivered']);
  } else if (status === 'closed') {
    q = q.eq('status', 'closed_delivered');
  } else {
    q = q.eq('status', 'open');
  }

  if (filter.type) q = q.eq('type', filter.type);
  if (filter.worlds?.length) {
    if (filter.worlds.includes('items')) {
      q = q.or(`listing_world_slug.in.(${filter.worlds.join(',')}),listing_world_slug.is.null`);
    } else {
      q = q.in('listing_world_slug', filter.worlds);
    }
  }
  if (filter.categories?.length) q = q.in('category', filter.categories);
  if (filter.itemConditions?.length) q = q.in('item_condition', filter.itemConditions);
  if (filter.searchQuery) q = q.or(feedTextSearchOrClause(filter.searchQuery));
  // locationFilter is intentionally not handled here — any valid radius
  // request reaches us through the ranked RPC path. GetFeedUseCase already
  // drops incoherent locationFilters (missing city / radius<=0).

  const decoded = decodeCursor(cursor);
  const oldestFirst = filter.sortOrder === 'oldest';
  if (decoded?.postId) {
    // Keyset on (created_at, post_id): posts sharing a timestamp are neither
    // skipped nor repeated across pages. Values are validated by decodeCursor.
    const op = oldestFirst ? 'gt' : 'lt';
    const ts = `"${decoded.createdAt}"`; // quoted: ISO timestamps contain reserved `.` and `:`
    q = q.or(`created_at.${op}.${ts},and(created_at.eq.${ts},post_id.${op}.${decoded.postId})`);
  } else if (decoded) {
    q = oldestFirst
      ? q.gt('created_at', decoded.createdAt)
      : q.lt('created_at', decoded.createdAt);
  }
  q = q.order('created_at', { ascending: oldestFirst }).order('post_id', { ascending: oldestFirst });
  q = q.limit(pageLimit + 1);

  return q;
}

/**
 * PostgREST errors that mean "the view isn't usable here" (not yet migrated, or the
 * relationship cache can't see through it) — fall back to `posts` instead of failing the feed.
 */
const VIEW_FALLBACK_CODES = new Set(['42P01', 'PGRST200', 'PGRST201', 'PGRST205', '42501']);

export function shouldFallbackToPosts(error: { code?: string | null } | null | undefined): boolean {
  return !!error?.code && VIEW_FALLBACK_CODES.has(error.code);
}

/** Simple-path page: signed-in viewers read feed_visible_posts (hides/mutes, 0417), else posts. */
export async function runSimpleFeedQuery(
  client: SupabaseClient<Database>,
  viewerId: string | null,
  filter: PostFeedFilter,
  cursor: string | undefined,
  pageLimit: number,
) {
  const first = await buildFeedQuery(client, filter, cursor, pageLimit, viewerId ? 'feed_visible_posts' : 'posts');
  if (first.error && viewerId && shouldFallbackToPosts(first.error)) {
    return buildFeedQuery(client, filter, cursor, pageLimit, 'posts');
  }
  return first;
}
