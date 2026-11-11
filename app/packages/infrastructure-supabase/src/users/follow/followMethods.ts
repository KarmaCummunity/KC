// app/packages/infrastructure-supabase/src/users/follow/followMethods.ts
// Concrete implementations of the IUserRepository follow-edge methods over the baseline's
// `follows` table. Select and delete are direct (policies `follows_select_member` and
// `follows_delete_party`); an edge is created only by `follow_user`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { FollowError } from '@kc/application';
import type { FollowEdge, User } from '@kc/domain';
import type { Database } from '../../database.types';
import { unwrapCall } from '../../rpc/mapRpcError';
import { USER_COLUMNS } from '../mapUserRow';
import { hydrateUsers } from '../userReads';
import { callFollowUser } from './followUserRpc';

/**
 * FR-FOLLOW-001 — follows a Public profile. A Private profile cannot be followed directly
 * (FR-FOLLOW-012 AC2): `follow_user` files a request there, which this method reports as
 * `request_required` so the caller shows the "requested" state. Repeating the call on an
 * existing edge returns the same edge (the server is idempotent).
 */
export async function followEdge(
  client: SupabaseClient<Database>,
  followerId: string,
  followedId: string,
): Promise<FollowEdge> {
  const outcome = await callFollowUser(client, followedId);
  if (outcome === 'requested') {
    throw new FollowError('request_required', 'the profile is private; a follow request was filed');
  }
  // The RPC returns no row: the edge is stamped with the client clock.
  return { followerId, followedId, createdAt: new Date().toISOString() };
}

export async function unfollowEdge(
  client: SupabaseClient<Database>,
  followerId: string,
  followedId: string,
): Promise<void> {
  unwrapCall(
    'table:follows',
    await client.from('follows').delete().eq('follower_id', followerId).eq('followed_id', followedId),
  );
}

export async function isFollowingEdge(
  client: SupabaseClient<Database>,
  followerId: string,
  followedId: string,
): Promise<boolean> {
  const row = unwrapCall(
    'table:follows',
    await client
      .from('follows')
      .select('follower_id')
      .eq('follower_id', followerId)
      .eq('followed_id', followedId)
      .maybeSingle(),
  );
  return row !== null;
}

/** Which end of the edge a list shows: the followers of a member, or the members they follow. */
type Side = 'followers' | 'following';

const SIDE_COLUMNS = {
  followers: { of: 'followed_id', shown: 'follower_id' },
  following: { of: 'follower_id', shown: 'followed_id' },
} as const;

/** `created_at` of the edge whose shown member is `cursor`; null when that edge is gone. */
async function cursorStamp(
  client: SupabaseClient<Database>,
  side: Side,
  userId: string,
  cursor: string,
): Promise<string | null> {
  const { of, shown } = SIDE_COLUMNS[side];
  const row = unwrapCall(
    'table:follows',
    await client.from('follows').select('created_at').eq(of, userId).eq(shown, cursor).maybeSingle(),
  );
  return row?.created_at ?? null;
}

/**
 * One page of a follower / following list, newest edge first. `cursor` is the previous page's
 * last member id; it is resolved to that edge's `created_at`, so the page continues strictly
 * after it. Members the caller cannot see (inactive, blocked) are left out.
 */
async function listSide(
  client: SupabaseClient<Database>,
  side: Side,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<User[]> {
  const { of, shown } = SIDE_COLUMNS[side];
  const before = cursor ? await cursorStamp(client, side, userId, cursor) : null;
  const base = client
    .from('follows')
    .select('follower_id, followed_id, created_at')
    .eq(of, userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const edges = unwrapCall('table:follows', await (before ? base.lt('created_at', before) : base)) ?? [];
  const ids = edges.map((edge) => edge[shown]);
  if (ids.length === 0) return [];
  const rows = unwrapCall('table:users', await client.from('users').select(USER_COLUMNS).in('id', ids)) ?? [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.flatMap((id) => byId.get(id) ?? []);
  return hydrateUsers(client, ordered);
}

export function listFollowers(
  client: SupabaseClient<Database>,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<User[]> {
  return listSide(client, 'followers', userId, limit, cursor);
}

export function listFollowing(
  client: SupabaseClient<Database>,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<User[]> {
  return listSide(client, 'following', userId, limit, cursor);
}
