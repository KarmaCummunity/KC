import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlockedUser, IBlockRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** Postgres `unique_violation`: the block row already exists. */
const UNIQUE_VIOLATION = '23505';

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
   * FR-MOD-004 AC1 — the caller's own blocks, newest first, with the blocked member's display
   * fields. The blocker cannot read those rows directly (the restrictive policy
   * `users_hide_blocked` hides them), so the security-definer RPC `list_my_blocked_users`
   * (migration 0015) returns them. One page: the server default of 50 covers the screen.
   */
  async listMyBlockedUsers(): Promise<BlockedUser[]> {
    const rows = unwrapCall('rpc:list_my_blocked_users', await this.client.rpc('list_my_blocked_users'));
    return (rows ?? []).map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      blockedAt: row.blocked_at,
    }));
  }
}
