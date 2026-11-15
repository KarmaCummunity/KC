// Organizations, #tags and suggested searches of the universal search (map row M05, migration
// 0031): `search_organizations`, `search_hashtags` (counted over the posts the caller can read)
// and `search_suggested_queries` (the most used tags of the last 30 days). A query shorter than
// two characters finds no organization; an empty query shows the suggestions only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HashtagSearchResult, OrgSearchResult } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

export interface SocialSearchParts {
  readonly orgs: OrgSearchResult[];
  readonly hashtags: HashtagSearchResult[];
  readonly suggestedQueries: string[];
}

const LIMIT = 10;

async function searchOrgs(client: Client, text: string): Promise<OrgSearchResult[]> {
  if (text.length < 2) return [];
  const rows = unwrapCall('rpc:search_organizations', await client.rpc('search_organizations', { p_query: text, p_limit: LIMIT }));
  return (rows ?? []).map((row) => ({ orgId: row.org_id, name: row.name, slug: row.slug }));
}

async function searchTags(client: Client, text: string): Promise<HashtagSearchResult[]> {
  const rows = unwrapCall('rpc:search_hashtags', await client.rpc('search_hashtags', { p_query: text, p_limit: LIMIT }));
  return (rows ?? []).map((row) => ({ tag: row.tag, useCount: Number(row.use_count) }));
}

async function suggestedQueries(client: Client): Promise<string[]> {
  const rows = unwrapCall('rpc:search_suggested_queries', await client.rpc('search_suggested_queries', { p_limit: 8 }));
  return (rows ?? []).filter((q): q is string => typeof q === 'string');
}

/** The social parts for a query; `wantSocial` false (a filtered search) returns none. */
export async function searchSocialParts(client: Client, query: string, wantSocial: boolean): Promise<SocialSearchParts> {
  const text = query.trim();
  if (!wantSocial) return { orgs: [], hashtags: [], suggestedQueries: [] };
  if (text.length === 0) return { orgs: [], hashtags: [], suggestedQueries: await suggestedQueries(client) };
  const [orgs, hashtags] = await Promise.all([searchOrgs(client, text), searchTags(client, text)]);
  return { orgs, hashtags, suggestedQueries: [] };
}
