// The app's feed filter → the `p_filters` document of `feed_page` / `search_posts_page`
// (docs/db/app-migration-map.md: `feed_ranked_ids` → `feed_page`), and the part of the filter the
// baseline cannot apply, which the adapter applies to the returned page instead.

import type { PostFeedFilter, PostWithOwner } from '@kc/application';
import type { FeedSortOrder } from '@kc/domain';
import type { Json } from '../database.types';
import { directionOf, type PostCatalog } from './postCatalog';

const SORT: Readonly<Record<FeedSortOrder, string>> = {
  newest: 'newest',
  oldest: 'oldest',
  distance: 'nearest',
  personalized: 'recommended',
};

/** A free-text query counts only from two characters on (FR-FEED-003). */
const MIN_QUERY_LENGTH = 2;

/** Item subcategory ids of the filter: the chosen item categories plus the explicit subcategory ids. */
function subcategoryIds(filter: PostFeedFilter, catalog: PostCatalog): string[] {
  const fromCategories = (filter.categories ?? []).flatMap((category) => {
    const id = catalog.subcategoryIdOf.get(category);
    return id ? [id] : [];
  });
  return [...fromCategories, ...(filter.subcategories ?? [])];
}

/**
 * `p_filters` for the filter. Keys are added only when the filter asks for them, as the function
 * documents. One world is sent as `world`; several worlds are narrowed on the returned page.
 */
export function buildFeedFilters(filter: PostFeedFilter, catalog: PostCatalog): { [key: string]: Json } {
  const out: { [key: string]: Json } = { sort: SORT[filter.sortOrder ?? 'newest'] };
  if (filter.type) out['direction'] = directionOf(filter.type);
  const worlds = filter.worlds ?? [];
  if (worlds.length === 1 && worlds[0]) out['world'] = worlds[0];
  const subcategories = subcategoryIds(filter, catalog);
  if (subcategories.length > 0) out['item_subcategory_ids'] = subcategories;
  if (filter.statusFilter) out['status'] = filter.statusFilter;
  if (filter.followersOnly) out['audience'] = 'following';
  if (filter.locationFilter) {
    out['city_id'] = filter.locationFilter.centerCity;
    out['radius_km'] = filter.locationFilter.radiusKm;
  }
  if (filter.proximitySortCity) out['near_city_id'] = filter.proximitySortCity;
  const query = filter.searchQuery?.trim() ?? '';
  if (query.length >= MIN_QUERY_LENGTH) out['q'] = query;
  return out;
}

/**
 * The filter terms `feed_page` has no argument for, applied to the page it returned: several worlds
 * at once, and the item condition (a free field of the post's `details`, FR-FEED-004). A page
 * narrowed this way can be shorter than the page size; the cursor still advances.
 */
export function narrowPage(posts: PostWithOwner[], filter: PostFeedFilter): PostWithOwner[] {
  const worlds = filter.worlds ?? [];
  const conditions = filter.type === 'Give' ? (filter.itemConditions ?? []) : [];
  return posts.filter((post) => {
    if (worlds.length > 1 && !worlds.includes(post.listingWorldSlug ?? 'items')) return false;
    if (conditions.length > 0 && (post.itemCondition === null || !conditions.includes(post.itemCondition))) {
      return false;
    }
    return true;
  });
}
