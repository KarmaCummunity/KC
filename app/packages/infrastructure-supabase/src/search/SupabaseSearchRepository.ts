// SupabaseSearchRepository — thin orchestrator (FR-FEED-017+).
// Query logic: searchExploreHelpers / searchQueryHelpers / searchUserReads / searchMappers / searchUtils.
//
// Posts, members and links come from their page functions; organizations, #tags and suggested
// searches from searchSocialReads (M05, migration 0031). A failure of those social parts leaves
// them empty instead of failing the whole search.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchFilters } from '@kc/domain';
import type { ISearchRepository, UniversalSearchResults } from '@kc/application';
import type { Database } from '../database.types';
import { EMPTY_SEARCH_BUCKET } from './searchBucket';
import { explorePosts, exploreUsers, exploreLinks } from './searchExploreHelpers';
import { searchPosts, searchUsers, searchLinks } from './searchQueryHelpers';
import { searchSocialParts, type SocialSearchParts } from './searchSocialReads';

const NO_SOCIAL: SocialSearchParts = { orgs: [], hashtags: [], suggestedQueries: [] };

/** Runs the explore page when there is no query text, otherwise the query page. */
function pickBucket<T>(isExplore: boolean, explore: () => Promise<T>, query: () => Promise<T>): Promise<T> {
  return isExplore ? explore() : query();
}

export class SupabaseSearchRepository implements ISearchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** `viewerId` is unused: the server answers for the signed-in caller, whose rights filter every result. */
  async search(
    query: string,
    filters: SearchFilters,
    _viewerId: string | null,
    limits: { posts: number; users: number; links: number },
  ): Promise<UniversalSearchResults> {
    const wantPosts = !filters.resultType || filters.resultType === 'post';
    const wantUsers = !filters.resultType || filters.resultType === 'user';
    const wantLinks = !filters.resultType || filters.resultType === 'link';
    const isExplore = !query || query.trim().length === 0;
    const text = query.trim();

    const [postBucket, userBucket, linkBucket, social] = await Promise.all([
      !wantPosts
        ? EMPTY_SEARCH_BUCKET
        : pickBucket(isExplore, () => explorePosts(this.client, filters, limits.posts), () => searchPosts(this.client, text, filters, limits.posts)),
      !wantUsers
        ? EMPTY_SEARCH_BUCKET
        : pickBucket(isExplore, () => exploreUsers(this.client, filters, limits.users), () => searchUsers(this.client, text, filters, limits.users)),
      !wantLinks
        ? EMPTY_SEARCH_BUCKET
        : pickBucket(isExplore, () => exploreLinks(this.client, filters, limits.links), () => searchLinks(this.client, text, filters, limits.links)),
      searchSocialParts(this.client, text, !filters.resultType).catch(() => NO_SOCIAL),
    ]);

    return {
      posts: [...postBucket.items],
      users: [...userBucket.items],
      links: [...linkBucket.items],
      orgs: social.orgs,
      hashtags: social.hashtags,
      suggestedQueries: social.suggestedQueries,
      postsTotal: postBucket.total,
      usersTotal: userBucket.total,
      linksTotal: linkBucket.total,
      postsHasMore: postBucket.hasMore,
      usersHasMore: userBucket.hasMore,
      linksHasMore: linkBucket.hasMore,
      orgsTotal: social.orgs.length,
      hashtagsTotal: social.hashtags.length,
    };
  }
}
