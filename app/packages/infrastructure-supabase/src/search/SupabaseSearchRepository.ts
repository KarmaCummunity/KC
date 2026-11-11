// SupabaseSearchRepository — thin orchestrator (FR-FEED-017+).
// Query logic: searchExploreHelpers / searchQueryHelpers / searchUserReads / searchMappers / searchUtils.
//
// The baseline searches posts and members only. Organizations, hashtags and suggested queries have
// no source (M05: the suggested-queries call is dropped and the screen keeps its local recent
// searches), so those parts of the result are always empty.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchFilters } from '@kc/domain';
import type { ISearchRepository, UniversalSearchResults } from '@kc/application';
import type { Database } from '../database.types';
import { EMPTY_SEARCH_BUCKET } from './searchBucket';
import { explorePosts, exploreUsers, exploreLinks } from './searchExploreHelpers';
import { searchPosts, searchUsers, searchLinks } from './searchQueryHelpers';

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

    const [postBucket, userBucket, linkBucket] = await Promise.all([
      !wantPosts
        ? EMPTY_SEARCH_BUCKET
        : isExplore
          ? explorePosts(this.client, filters, limits.posts)
          : searchPosts(this.client, text, filters, limits.posts),
      !wantUsers
        ? EMPTY_SEARCH_BUCKET
        : isExplore
          ? exploreUsers(this.client, filters, limits.users)
          : searchUsers(this.client, text, filters, limits.users),
      !wantLinks
        ? EMPTY_SEARCH_BUCKET
        : isExplore
          ? exploreLinks(this.client, filters, limits.links)
          : searchLinks(this.client, text, filters, limits.links),
    ]);

    return {
      posts: [...postBucket.items],
      users: [...userBucket.items],
      links: [...linkBucket.items],
      orgs: [],
      hashtags: [],
      suggestedQueries: [],
      postsTotal: postBucket.total,
      usersTotal: userBucket.total,
      linksTotal: linkBucket.total,
      postsHasMore: postBucket.hasMore,
      usersHasMore: userBucket.hasMore,
      linksHasMore: linkBucket.hasMore,
      orgsTotal: 0,
      hashtagsTotal: 0,
    };
  }
}
