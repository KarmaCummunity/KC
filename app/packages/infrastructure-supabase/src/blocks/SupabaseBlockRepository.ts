import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlockedUser, IBlockRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** Postgres `unique_violation`: the block row already exists. */
const UNIQUE_VIOLATION = '23505';
/** Rows per `list_my_blocked_users` page (the server's maximum). */
const BLOCKED_PAGE_SIZE = 100;
/** Pages read at most: a member blocks a handful of people, this only bounds a runaway loop. */
const BLOCKED_MAX_PAGES = 20;

/** `public.blocks` — RLS lets a user read/insert/delete only rows where they are the blocker. */
export class SupabaseBlockRepository implements IBlockRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async isBlocking(blockerId: string, blockedId: string): Promise<boolean> {
    const row = unwrapCall(
      'table:blocks',
      await this.client
        .from('blocks')
        .select('blocked_id')
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId)
        .maybeSingle(),
    );
    return row !== null;
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.client.from('blocks').insert({ blocker_id: blockerId, blocked_id: blockedId });
    // Already blocked — treat as success (idempotent).
    if (error && error.code !== UNIQUE_VIOLATION) unwrapCall('table:blocks', { data: null, error });
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    unwrapCall(
      'table:blocks',
      await this.client.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId),
    );
  }

  /**
   * FR-MOD-004 AC1 — every block of the caller, newest first. The blocked member's profile row is
   * hidden from the blocker (`users_hide_blocked`), so the names come from the definer RPC
   * `list_my_blocked_users` (migration 0015), read one keyset page after another.
   */
  async listMyBlockedUsers(): Promise<BlockedUser[]> {
    const users: BlockedUser[] = [];
    let cursor: BlockedUser | undefined;
    for (let page = 0; page < BLOCKED_MAX_PAGES; page += 1) {
      const rows = unwrapCall(
        'rpc:list_my_blocked_users',
        await this.client.rpc('list_my_blocked_users', {
          p_before_blocked_at: cursor?.blockedAt,
          p_before_user_id: cursor?.userId,
          p_limit: BLOCKED_PAGE_SIZE,
        }),
      ) ?? [];
      users.push(...rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        blockedAt: row.blocked_at,
      })));
      if (rows.length < BLOCKED_PAGE_SIZE) break;
      cursor = users[users.length - 1];
    }
    return users;
  }
}
