// SupabaseSearchRepository — thin orchestrator (FR-FEED-017+).
// Query logic: searchExploreHelpers / searchQueryHelpers / searchMappers / searchConstants / searchUtils.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HashtagSearchResult, OrgSearchResult, SearchFilters } from '@kc/domain';
import type { ISearchRepository, UniversalSearchResults } from '@kc/application';
import type { Database } from '../database.legacy.types';
import { EMPTY_SEARCH_BUCKET } from './searchBucket';
import { explorePosts, exploreUsers, exploreLinks } from './searchExploreHelpers';
import { searchPosts, searchUsers, searchLinks } from './searchQueryHelpers';

export class SupabaseSearchRepository implements ISearchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async search(
    query: string,
    filters: SearchFilters,
    viewerId: string | null,
    limits: { posts: number; users: number; links: number },
  ): Promise<UniversalSearchResults> {
    const wantPosts = !filters.resultType || filters.resultType === 'post';
    const wantUsers = !filters.resultType || filters.resultType === 'user';
    const wantLinks = !filters.resultType || filters.resultType === 'link';
    const wantOrgs = !filters.resultType || filters.resultType === 'org';
    const wantHashtags = !filters.resultType || filters.resultType === 'hashtag';
    const isExplore = !query || query.trim().length === 0;

    const [postBucket, userBucket, linkBucket, socialExtras] = await Promise.all([
      wantPosts
        ? isExplore
          ? explorePosts(this.client, filters, limits.posts, viewerId)
          : searchPosts(this.client, query, filters, limits.posts, viewerId)
        : Promise.resolve(EMPTY_SEARCH_BUCKET),
      wantUsers
        ? isExplore
          ? exploreUsers(this.client, filters, viewerId, limits.users)
          : searchUsers(this.client, query, filters, viewerId, limits.users)
        : Promise.resolve(EMPTY_SEARCH_BUCKET),
      wantLinks
        ? isExplore
          ? exploreLinks(this.client, filters, limits.links)
          : searchLinks(this.client, query, filters, limits.links)
        : Promise.resolve(EMPTY_SEARCH_BUCKET),
      this.fetchSocialSearchExtras(query, wantOrgs, wantHashtags, isExplore),
    ]);

    return {
      posts: [...postBucket.items],
      users: [...userBucket.items],
      links: [...linkBucket.items],
      orgs: socialExtras.orgs,
      hashtags: socialExtras.hashtags,
      suggestedQueries: socialExtras.suggested,
      postsTotal: postBucket.total,
      usersTotal: userBucket.total,
      linksTotal: linkBucket.total,
      postsHasMore: postBucket.hasMore,
      usersHasMore: userBucket.hasMore,
      linksHasMore: linkBucket.hasMore,
      orgsTotal: socialExtras.orgs.length,
      hashtagsTotal: socialExtras.hashtags.length,
    };
  }

  private async fetchSocialSearchExtras(
    query: string,
    wantOrgs: boolean,
    wantHashtags: boolean,
    isExplore: boolean,
  ): Promise<{ orgs: OrgSearchResult[]; hashtags: HashtagSearchResult[]; suggested: string[] }> {
    const types: string[] = [];
    if (wantOrgs) types.push('orgs');
    if (wantHashtags) types.push('hashtags');
    if (types.length === 0 && isExplore) {
      const { data: suggested, error } = await this.client.rpc('rpc_search_suggested_queries' as never);
      if (error) return { orgs: [], hashtags: [], suggested: [] };
      return { orgs: [], hashtags: [], suggested: (suggested as string[]) ?? [] };
    }
    if (types.length === 0 || isExplore) {
      const { data: suggested, error } = await this.client.rpc('rpc_search_suggested_queries' as never);
      return {
        orgs: [],
        hashtags: [],
        suggested: error ? [] : ((suggested as string[]) ?? []),
      };
    }
    const { data, error } = await this.client.rpc('search_all' as never, {
      p_query: query.trim(),
      p_types: types,
      p_limit: 20,
    } as never);
    if (error || !data) return { orgs: [], hashtags: [], suggested: [] };
    const payload = data as {
      orgs?: Array<{ org_id: string; name: string; slug: string }>;
      hashtags?: Array<{ tag: string; use_count: number }>;
    };
    return {
      orgs: (payload.orgs ?? []).map((o) => ({
        orgId: o.org_id,
        name: o.name,
        slug: o.slug,
      })),
      hashtags: (payload.hashtags ?? []).map((h) => ({
        tag: h.tag,
        useCount: h.use_count,
      })),
      suggested: [],
    };
  }
}
