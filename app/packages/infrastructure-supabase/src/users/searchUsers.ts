// Substring search on display_name OR share_handle. Extracted from
// SupabaseUserRepository so the parent file stays under cap. Used by the
// closure flow's "pick from any user" mode (FR-CLOSURE-003 extension).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { mapUserRow, type UserRow } from './mapUserRow';
import { scrubUserForNonOwner } from './scrubUserForViewer';
import { USER_PUBLIC_SELECT_COLUMNS } from './userPublicColumns';
import { quoteOrValue } from '../search/searchUtils';

export async function searchUsers(
  client: SupabaseClient<Database>,
  query: string,
  opts: { excludeUserId: string; limit: number },
): Promise<User[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const v = quoteOrValue(q);
  const { data, error } = await client
    .from('users')
    .select(USER_PUBLIC_SELECT_COLUMNS)
    .or(`display_name.ilike.${v},share_handle.ilike.${v}`)
    .neq('user_id', opts.excludeUserId)
    .limit(Math.min(50, Math.max(1, opts.limit)));
  if (error) throw new Error(`searchUsers: ${error.message}`);

  const blockedIds = await fetchBlockedIdsSafe(client, opts.excludeUserId);
  return ((data ?? []) as unknown as UserRow[])
    .filter((u) => !blockedIds.has(u.user_id))
    .map((row) => scrubUserForNonOwner(mapUserRow(row)));
}

async function fetchBlockedIdsSafe(
  client: SupabaseClient<Database>,
  blockerId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await client
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', blockerId);
    if (error) return new Set();
    return new Set(((data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id));
  } catch {
    return new Set();
  }
}
