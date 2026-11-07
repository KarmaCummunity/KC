// Search-mode (text query) helpers for SupabaseSearchRepository.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DonationLinkSearchResult, SearchFilters, UserSearchResult } from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import type { Database } from '../database.types';
import { POST_SELECT_OWNER, mapPostWithOwnerRow, type PostWithOwnerJoinedRow } from '../posts/mapPostRow';
import { applyPostActorIdentityProjectionBatch } from '../posts/applyPostActorIdentityProjection';
import { dropOrphanDeletedOwnerPosts } from '../posts/dropOrphanDeletedOwnerPosts';
import { hydrateFeedPostOwners } from '../posts/hydrateFeedPostOwners';
import { type LinkRow, type SearchUserRow, mapUserSearchResult, mapLinkSearchResult } from './searchMappers';
import { orderByIds, pageFetchSize, toPagedBucket, type SearchBucket } from './searchBucket';
import { quoteOrValue, findMatchingCategorySlug } from './searchUtils';

type C = SupabaseClient<Database>;
const U = 'user_id, display_name, share_handle, avatar_url, biography, city, city_name, followers_count, items_given_count, verification_level';

export async function searchPosts(
  c: C,
  query: string,
  f: SearchFilters,
  limit: number,
  viewerId?: string | null,
): Promise<SearchBucket<PostWithOwner>> {
  // Ids via the paged RPC (trigram candidates, lazy visibility; no count — 0418).
  const { data: idRows, error } = await c.rpc('search_posts_page', {
    p_query: query,
    p_type: f.postType ?? undefined,
    p_category: f.category ?? undefined,
    p_city: f.city ?? undefined,
    p_limit: pageFetchSize(limit),
  });
  if (error) throw new Error(`searchPosts: ${error.message}`);
  const page = toPagedBucket((idRows ?? []).map((r) => r.post_id), limit);
  if (page.items.length === 0) return { items: [], total: 0, hasMore: false };
  // Hydrate through posts RLS (defence in depth) and keep the RPC order.
  const { data, error: hydrateError } = await c
    .from('posts')
    .select(POST_SELECT_OWNER)
    .in('post_id', [...page.items]);
  if (hydrateError) throw new Error(`searchPosts: ${hydrateError.message}`);
  const rows = orderByIds(page.items, (data ?? []) as unknown as PostWithOwnerJoinedRow[], (r) => r.post_id);
  const mapped = rows.map(mapPostWithOwnerRow);
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

export async function searchUsers(
  c: C,
  query: string,
  f: SearchFilters,
  _v: string | null,
  limit: number,
): Promise<SearchBucket<UserSearchResult>> {
  const { data: idRows, error } = await c.rpc('search_users_page', {
    p_query: query,
    p_city: f.city ?? undefined,
    p_min_followers: f.minFollowers && f.minFollowers > 0 ? f.minFollowers : undefined,
    p_sort: f.sortBy === 'newest' ? 'newest' : 'followers',
    p_limit: pageFetchSize(limit),
  });
  if (error) throw new Error(`searchUsers: ${error.message}`);
  const page = toPagedBucket((idRows ?? []).map((r) => r.user_id), limit);
  if (page.items.length === 0) return { items: [], total: 0, hasMore: false };
  const { data, error: hydrateError } = await c.from('users').select(U).in('user_id', [...page.items]);
  if (hydrateError) throw new Error(`searchUsers: ${hydrateError.message}`);
  const rows = orderByIds(page.items, (data ?? []) as SearchUserRow[], (r) => r.user_id);
  const items = rows.map(mapUserSearchResult);
  return { items, total: items.length, hasMore: page.hasMore };
}

export async function searchLinks(
  c: C,
  query: string,
  f: SearchFilters,
  limit: number,
): Promise<SearchBucket<DonationLinkSearchResult>> {
  const v = quoteOrValue(query);
  const slug = findMatchingCategorySlug(query.toLowerCase());
  let q = c.from('donation_links').select('id, category_slug, url, display_name, description, tags').is('hidden_at', null);
  if (slug && !f.donationCategory) {
    q = q.or(`display_name.ilike.${v},description.ilike.${v},url.ilike.${v},category_slug.eq.${slug}`);
  } else {
    q = q.or(`display_name.ilike.${v},description.ilike.${v},url.ilike.${v}`);
  }
  if (f.donationCategory) q = q.eq('category_slug', f.donationCategory);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(pageFetchSize(limit));
  if (error) throw new Error(`searchLinks: ${error.message}`);
  return toPagedBucket(((data ?? []) as unknown as LinkRow[]).map(mapLinkSearchResult), limit);
}
