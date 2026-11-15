// Substring search on display_name OR share_handle. Extracted from
// SupabaseUserRepository so the parent file stays under cap. Used by the
// closure flow's "pick from any user" mode (FR-CLOSURE-003 extension).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { quoteOrValue } from '../search/searchUtils';
import { USER_COLUMNS } from './mapUserRow';
import { hydrateUsers } from './userReads';

/**
 * Active members whose name or handle contains `query`, excluding the caller. Blocked members
 * never appear: the restrictive policy `users_hide_blocked` removes them from the result in
 * both directions, so the adapter needs no blocks lookup of its own.
 */
export async function searchUsers(
  client: SupabaseClient<Database>,
  query: string,
  opts: { excludeUserId: string; limit: number },
): Promise<User[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const v = quoteOrValue(q);
  const rows = unwrapCall(
    'table:users',
    await client
      .from('users')
      .select(USER_COLUMNS)
      .or(`display_name.ilike.${v},share_handle.ilike.${v}`)
      .neq('id', opts.excludeUserId)
      .limit(Math.min(50, Math.max(1, opts.limit))),
  );
  return hydrateUsers(client, rows ?? []);
}
