// Search-mode (text query) helpers for SupabaseSearchRepository.
//   posts  `search_posts_page` — cards, the feed's filters and visibility rules, keyset paging;
//   people `search_users_page` — member ids by name / handle, most followed first;
//   links  `donation_links` — approved links, matched by a substring of name, description or address.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DonationLinkSearchResult, SearchFilters, UserSearchResult } from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import type { Database, Json } from '../database.types';
import { fetchSearchPage } from '../posts/postCardPages';
import { loadPostCatalog } from '../posts/postCatalog';
import { unwrapCall } from '../rpc/mapRpcError';
import { usersByIds } from './searchUserReads';
import { LINK_COLUMNS, mapLinkSearchResult, type LinkRow } from './searchMappers';
import { pageFetchSize, toPagedBucket, type SearchBucket } from './searchBucket';
import { quoteOrValue, findMatchingCategorySlug } from './searchUtils';

type C = SupabaseClient<Database>;

/** `p_filters` of the post search / explore for the search filters (the feed's keys). */
export async function postSearchFilters(c: C, f: SearchFilters): Promise<{ [key: string]: Json }> {
  const filters: { [key: string]: Json } = {};
  if (f.postType) filters['direction'] = f.postType === 'Give' ? 'offer' : 'request';
  if (f.category) {
    const subcategoryId = (await loadPostCatalog(c)).subcategoryIdOf.get(f.category);
    if (subcategoryId) filters['item_subcategory_ids'] = [subcategoryId];
  }
  if (f.city) filters['city_id'] = f.city;
  if (f.city && f.radiusKm) filters['radius_km'] = f.radiusKm;
  return filters;
}

export async function searchPosts(
  c: C,
  query: string,
  f: SearchFilters,
  limit: number,
): Promise<SearchBucket<PostWithOwner>> {
  const page = await fetchSearchPage(c, query, await postSearchFilters(c, f), pageFetchSize(limit));
  return toPagedBucket(page.posts, limit);
}

export async function searchUsers(
  c: C,
  query: string,
  f: SearchFilters,
  limit: number,
): Promise<SearchBucket<UserSearchResult>> {
  const filters: { [key: string]: Json } = {};
  if (f.city) filters['city_id'] = f.city;
  if (f.minFollowers && f.minFollowers > 0) filters['min_followers'] = f.minFollowers;
  const rows = unwrapCall(
    'rpc:search_users_page',
    await c.rpc('search_users_page', { p_query: query, p_limit: pageFetchSize(limit), p_filters: filters }),
  );
  const page = toPagedBucket((rows ?? []).map((row) => row.id), limit);
  const items = await usersByIds(c, page.items);
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
  const byCategory = slug && !f.donationCategory ? `,category_slug.eq.${slug}` : '';
  let q = c
    .from('donation_links')
    .select(LINK_COLUMNS)
    .eq('review_status', 'approved')
    .or(`display_name.ilike.${v},description.ilike.${v},url.ilike.${v}${byCategory}`);
  if (f.donationCategory) q = q.eq('category_slug', f.donationCategory);
  const rows = unwrapCall(
    'table:donation_links',
    await q.order('created_at', { ascending: false }).limit(pageFetchSize(limit)),
  );
  return toPagedBucket(((rows ?? []) as LinkRow[]).map(mapLinkSearchResult), limit);
}
