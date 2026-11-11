// Explore-mode (no query) helpers for SupabaseSearchRepository. Has-more paging, no counts (0418).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DonationLinkSearchResult, SearchFilters, UserSearchResult } from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import type { Database } from '../database.legacy.types';
import { POST_SELECT_OWNER, mapPostWithOwnerRow, type PostWithOwnerJoinedRow } from '../posts/mapPostRow';
import { applyPostActorIdentityProjectionBatch } from '../posts/applyPostActorIdentityProjection';
import { dropOrphanDeletedOwnerPosts } from '../posts/dropOrphanDeletedOwnerPosts';
import { hydrateFeedPostOwners } from '../posts/hydrateFeedPostOwners';
import { type LinkRow, type SearchUserRow, mapUserSearchResult, mapLinkSearchResult } from './searchMappers';
import { pageFetchSize, toPagedBucket, type SearchBucket } from './searchBucket';

type C = SupabaseClient<Database>;
const U = 'user_id, display_name, share_handle, avatar_url, biography, city, city_name, followers_count, items_given_count, verification_level';

export async function explorePosts(
  c: C,
  f: SearchFilters,
  limit: number,
  viewerId?: string | null,
): Promise<SearchBucket<PostWithOwner>> {
  let q = c.from('posts').select(POST_SELECT_OWNER).eq('status', 'open');
  if (f.postType) q = q.eq('type', f.postType);
  if (f.category) q = q.eq('category', f.category);
  if (f.city) q = q.eq('city', f.city);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(pageFetchSize(limit));
  if (error) throw new Error(`explorePosts: ${error.message}`);
  const page = toPagedBucket((data ?? []) as unknown as PostWithOwnerJoinedRow[], limit);
  const mapped = page.items.map(mapPostWithOwnerRow);
  const items = dropOrphanDeletedOwnerPosts(
    await applyPostActorIdentityProjectionBatch(
      c,
      await hydrateFeedPostOwners(c, mapped),
      viewerId ?? null,
    ),
    viewerId ?? null,
  );
  return { items, total: items.length, hasMore: page.hasMore };
}

export async function exploreUsers(
  c: C,
  f: SearchFilters,
  _v: string | null,
  limit: number,
): Promise<SearchBucket<UserSearchResult>> {
  let q = c.from('users').select(U);
  if (f.city) q = q.eq('city', f.city);
  if (f.minFollowers && f.minFollowers > 0) q = q.gte('followers_count', f.minFollowers);
  const { data, error } = await q.order('followers_count', { ascending: false }).limit(pageFetchSize(limit));
  if (error) throw new Error(`exploreUsers: ${error.message}`);
  return toPagedBucket(((data ?? []) as SearchUserRow[]).map(mapUserSearchResult), limit);
}

export async function exploreLinks(
  c: C,
  f: SearchFilters,
  limit: number,
): Promise<SearchBucket<DonationLinkSearchResult>> {
  let q = c.from('donation_links').select('id, category_slug, url, display_name, description, tags').is('hidden_at', null);
  if (f.donationCategory) q = q.eq('category_slug', f.donationCategory);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(pageFetchSize(limit));
  if (error) throw new Error(`exploreLinks: ${error.message}`);
  return toPagedBucket(((data ?? []) as unknown as LinkRow[]).map(mapLinkSearchResult), limit);
}
