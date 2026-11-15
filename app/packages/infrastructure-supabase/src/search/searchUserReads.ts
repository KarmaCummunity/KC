// Member reads of the search: complete a list of ids into search results, and the "top members"
// list shown before the user types (explore mode).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchFilters, UserSearchResult } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { USER_COLUMNS } from '../users/mapUserRow';
import { hydrateUsers } from '../users/userReads';
import { mapUserSearchResult } from './searchMappers';
import { orderByIds } from './searchBucket';

type C = SupabaseClient<Database>;

/** Members considered when a city is chosen: the counters cannot be ordered across the city filter. */
const CITY_SCAN_MAX = 200;

/** Search results for `ids`, in that order (an id the caller cannot read is dropped). */
export async function usersByIds(c: C, ids: readonly string[]): Promise<UserSearchResult[]> {
  if (ids.length === 0) return [];
  const rows = unwrapCall('table:users', await c.from('users').select(USER_COLUMNS).in('id', [...ids]));
  const users = await hydrateUsers(c, rows ?? []);
  return orderByIds(ids, users, (user) => user.userId).map(mapUserSearchResult);
}

async function followerCounts(c: C, ids: readonly string[] | null, min: number, limit: number) {
  let query = c.from('user_stats').select('user_id, followers_count').gte('followers_count', min);
  if (ids) query = query.in('user_id', [...ids]);
  const rows = unwrapCall(
    'table:user_stats',
    await query.order('followers_count', { ascending: false }).limit(limit),
  );
  return (rows ?? []).map((row) => row.user_id);
}

/** Ids of the most followed members, restricted to a city when the filter names one. */
async function topMemberIds(c: C, f: SearchFilters, size: number): Promise<string[]> {
  const min = f.minFollowers && f.minFollowers > 0 ? f.minFollowers : 0;
  if (!f.city) return followerCounts(c, null, min, size);
  const inCity = unwrapCall(
    'table:users',
    await c.from('users').select('id').eq('city_id', f.city).limit(CITY_SCAN_MAX),
  );
  const ids = (inCity ?? []).map((row) => row.id);
  return ids.length === 0 ? [] : (await followerCounts(c, ids, min, size));
}

/** Explore mode: the most followed members first. */
export async function topMembers(c: C, f: SearchFilters, size: number): Promise<UserSearchResult[]> {
  return usersByIds(c, await topMemberIds(c, f, size));
}
