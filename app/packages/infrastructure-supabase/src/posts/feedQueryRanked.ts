// feedQueryRanked — distance-aware feed page via the `feed_ranked_ids` RPC.
// Mapped to FR-FEED-006 (Haversine sort) and the radius branch of FR-FEED-004.
//
// Round-trips:
//   1. RPC returns ordered post_id + distance_km tuples (server applies
//      filters, visibility predicate, and keyset cursor).
//   2. Card rows and identity rows are requested together, then re-ordered.
//
// The cursor used here is a 3-field JSON token so the same opaque string can
// move across all sort modes (newest/oldest use only `createdAt`).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FeedPage,
  PostFeedFilter,
  PostWithOwner,
} from '@kc/application';
import type { Database } from '../database.legacy.types';
import {
  FEED_CARD_SELECT,
  mapPostWithOwnerRow,
  type PostWithOwnerJoinedRow,
} from './mapPostRow';
import { dropOrphanDeletedOwnerPosts } from './dropOrphanDeletedOwnerPosts';
import { hydrateFeedPostOwners } from './hydrateFeedPostOwners';
import {
  applyPostActorIdentityProjectionBatch,
  fetchPostActorIdentitiesByPostIds,
} from './applyPostActorIdentityProjection';

export interface RankedCursor {
  distanceKm: number | null;
  createdAt: string;
  postId: string;
  rankScore?: number | null;
}

export function encodeRankedCursor(c: RankedCursor): string {
  return encodeURIComponent(JSON.stringify(c));
}

export function decodeRankedCursor(raw: string | undefined): RankedCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<RankedCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.postId !== 'string') return null;
    return {
      distanceKm: typeof parsed.distanceKm === 'number' ? parsed.distanceKm : null,
      createdAt: parsed.createdAt,
      postId: parsed.postId,
      rankScore: typeof parsed.rankScore === 'number' ? parsed.rankScore : null,
    };
  } catch {
    return null;
  }
}

export function needsRankedPath(filter: PostFeedFilter): boolean {
  if (filter.sortOrder === 'distance') return true;
  if (filter.sortOrder === 'personalized') return true;
  if (filter.locationFilter && filter.locationFilter.radiusKm > 0) return true;
  if (filter.followersOnly) return true;
  if (filter.subcategories && filter.subcategories.length > 0) return true;
  return false;
}

export async function fetchRankedFeedPage(
  client: SupabaseClient<Database>,
  viewerId: string | null,
  filter: PostFeedFilter,
  cursor: string | undefined,
  pageLimit: number,
): Promise<FeedPage> {
  const cursorParsed = decodeRankedCursor(cursor);

  const { data: rankedRows, error: rpcError } = await client.rpc('feed_ranked_ids', {
    p_viewer_id: viewerId ?? '00000000-0000-0000-0000-000000000000',
    p_filter_type: filter.type,
    p_filter_categories: filter.categories?.length ? filter.categories : undefined,
    p_filter_item_conditions: filter.itemConditions?.length ? filter.itemConditions : undefined,
    p_filter_status: filter.statusFilter ?? 'open',
    p_filter_center_city: filter.locationFilter?.centerCity,
    p_filter_radius_km: filter.locationFilter?.radiusKm,
    p_sort_order: filter.sortOrder ?? 'newest',
    p_proximity_sort_city: filter.proximitySortCity,
    p_page_limit: pageLimit + 1,
    p_cursor_distance: cursorParsed?.distanceKm ?? undefined,
    p_cursor_created_at: cursorParsed?.createdAt,
    p_cursor_post_id: cursorParsed?.postId,
    p_filter_search_query: filter.searchQuery ?? undefined,
    p_followers_only: filter.followersOnly ?? false,
    p_cursor_rank_score: cursorParsed?.rankScore ?? undefined,
    p_filter_worlds: filter.worlds?.length ? filter.worlds : undefined,
    p_filter_subcategories: filter.subcategories?.length ? filter.subcategories : undefined,
  } as never);
  if (rpcError) throw new Error(`feed_ranked_ids: ${rpcError.message}`);

  const ranked = (rankedRows ?? []) as Array<{
    post_id: string;
    distance_km: number | null;
    rank_score?: number | null;
  }>;
  if (ranked.length === 0) return { posts: [], nextCursor: null };

  const hasMore = ranked.length > pageLimit;
  const page = hasMore ? ranked.slice(0, pageLimit) : ranked;
  const ids = page.map((r) => r.post_id);

  // The identity rows only need the ids, so they travel with the post rows.
  // A failure here falls back to the projection's own read.
  const postsPromise = client.from('posts').select(FEED_CARD_SELECT).in('post_id', ids);
  const identityPromise = fetchPostActorIdentitiesByPostIds(client, ids).catch(() => undefined);
  const { data: postRows, error: postsError } = await postsPromise;
  if (postsError) throw new Error(`fetchRankedFeedPage.posts: ${postsError.message}`);
  const prefetchedIdentities = await identityPromise;

  // Re-order to match the RPC's ranking and attach distance_km.
  const byId = new Map<string, PostWithOwner>();
  for (const row of (postRows ?? []) as unknown as PostWithOwnerJoinedRow[]) {
    byId.set(row.post_id, mapPostWithOwnerRow(row));
  }
  const distanceById = new Map(page.map((r) => [r.post_id, r.distance_km]));
  const posts: PostWithOwner[] = [];
  for (const id of ids) {
    const post = byId.get(id);
    if (!post) continue;
    posts.push({ ...post, distanceKm: distanceById.get(id) ?? null });
  }

  const projected = dropOrphanDeletedOwnerPosts(
    await applyPostActorIdentityProjectionBatch(
      client,
      await hydrateFeedPostOwners(client, posts),
      viewerId,
      { prefetchedIdentities },
    ),
    viewerId,
  );

  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeRankedCursor({
        distanceKm: last.distance_km,
        createdAt: byId.get(last.post_id)?.createdAt ?? '',
        postId: last.post_id,
        rankScore: last.rank_score ?? null,
      })
    : null;

  return { posts: projected, nextCursor };
}
