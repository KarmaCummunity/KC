// Explore-mode (no query) helpers for SupabaseSearchRepository. Has-more paging, no counts (0418).
//   posts  `feed_page` in search scope — open posts of every world, newest first, with the filters;
//   people the most followed members;
//   links  the newest approved donation links.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DonationLinkSearchResult, SearchFilters, UserSearchResult } from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import type { Database } from '../database.types';
import { fetchFeedPage } from '../posts/postCardPages';
import { unwrapCall } from '../rpc/mapRpcError';
import { LINK_COLUMNS, mapLinkSearchResult, type LinkRow } from './searchMappers';
import { pageFetchSize, toPagedBucket, type SearchBucket } from './searchBucket';
import { postSearchFilters } from './searchQueryHelpers';
import { topMembers } from './searchUserReads';

type C = SupabaseClient<Database>;

export async function explorePosts(c: C, f: SearchFilters, limit: number): Promise<SearchBucket<PostWithOwner>> {
  const filters = { ...(await postSearchFilters(c, f)), scope: 'search', sort: 'newest', status: 'open' };
  const page = await fetchFeedPage(c, filters, pageFetchSize(limit));
  return toPagedBucket(page.posts, limit);
}

export async function exploreUsers(c: C, f: SearchFilters, limit: number): Promise<SearchBucket<UserSearchResult>> {
  return toPagedBucket(await topMembers(c, f, pageFetchSize(limit)), limit);
}

export async function exploreLinks(
  c: C,
  f: SearchFilters,
  limit: number,
): Promise<SearchBucket<DonationLinkSearchResult>> {
  let q = c.from('donation_links').select(LINK_COLUMNS).eq('review_status', 'approved');
  if (f.donationCategory) q = q.eq('category_slug', f.donationCategory);
  const rows = unwrapCall(
    'table:donation_links',
    await q.order('created_at', { ascending: false }).limit(pageFetchSize(limit)),
  );
  return toPagedBucket(((rows ?? []) as LinkRow[]).map(mapLinkSearchResult), limit);
}
