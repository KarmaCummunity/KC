// Reads that turn `users` rows into domain users (profile, search, follower lists).
//
// A `users` row is only the public profile; the city name, the counters and — for the caller's
// own row — the private state live elsewhere (see `mapUserRow.ts`). `hydrateUsers` loads those
// with one query per source for the whole page, so a list of 50 members costs three calls, not
// 100. No embedded selects: the relations between these tables are not one-to-one in the
// generated types.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@kc/domain';
import { fetchBootstrapSession } from '../auth/bootstrapSession';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import {
  mapUserRow,
  USER_COLUMNS,
  USER_STATS_COLUMNS,
  type OwnerSlice,
  type UserRow,
  type UserStatsRow,
} from './mapUserRow';

/**
 * The signed-in member's id from the cached session — no network round trip. Null when nobody
 * is signed in.
 */
export async function sessionUserId(client: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

/** The caller's private state (account, private profile, staff roles) in one call. */
async function loadOwnerSlice(client: SupabaseClient<Database>): Promise<OwnerSlice> {
  const [{ account, privateProfile, adminRoles }, karma] = await Promise.all([
    fetchBootstrapSession(client),
    client.rpc('my_karma_points'),
  ]);
  const karmaPoints = unwrapCall('rpc:my_karma_points', karma) ?? 0;
  return { account, privateProfile, adminRoles, karmaPoints };
}

async function loadCityNames(
  client: SupabaseClient<Database>,
  cityIds: readonly string[],
): Promise<Map<string, string>> {
  if (cityIds.length === 0) return new Map();
  const rows = unwrapCall(
    'table:cities',
    await client.from('cities').select('city_id, name_he').in('city_id', [...cityIds]),
  );
  return new Map((rows ?? []).map((city) => [city.city_id, city.name_he]));
}

async function loadStats(
  client: SupabaseClient<Database>,
  userIds: readonly string[],
): Promise<Map<string, UserStatsRow>> {
  const rows = unwrapCall(
    'table:user_stats',
    await client.from('user_stats').select(USER_STATS_COLUMNS).in('user_id', [...userIds]),
  );
  return new Map((rows ?? []).map((stats) => [stats.user_id, stats]));
}

/** Domain users for `rows`, in the same order, with city names, counters and (own row) private state. */
export async function hydrateUsers(client: SupabaseClient<Database>, rows: readonly UserRow[]): Promise<User[]> {
  if (rows.length === 0) return [];
  const viewerId = await sessionUserId(client);
  const cityIds = [...new Set(rows.flatMap((row) => (row.city_id ? [row.city_id] : [])))];
  const includesViewer = viewerId !== null && rows.some((row) => row.id === viewerId);
  const [cityNames, stats, owner] = await Promise.all([
    loadCityNames(client, cityIds),
    loadStats(client, rows.map((row) => row.id)),
    includesViewer ? loadOwnerSlice(client) : Promise.resolve(null),
  ]);
  return rows.map((row) =>
    mapUserRow(row, {
      cityName: row.city_id ? (cityNames.get(row.city_id) ?? null) : null,
      stats: stats.get(row.id) ?? null,
      owner: row.id === viewerId ? owner : null,
    }),
  );
}

/**
 * One member by `id` or `share_handle`; null when the profile is not visible to the caller
 * (inactive, or hidden by a block). TD-39 / TD-163: everything private is filled only for the
 * caller's own row (see `mapUserRow`).
 */
export async function fetchUserBy(
  client: SupabaseClient<Database>,
  column: 'id' | 'share_handle',
  value: string,
): Promise<User | null> {
  const row = unwrapCall(
    'table:users',
    await client.from('users').select(USER_COLUMNS).eq(column, value).maybeSingle(),
  );
  if (!row) return null;
  const [user] = await hydrateUsers(client, [row]);
  return user ?? null;
}
