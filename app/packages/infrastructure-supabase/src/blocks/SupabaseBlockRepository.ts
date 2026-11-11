import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlockedUser, IBlockRepository } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
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
   * FR-MOD-004 AC1 — M01: the baseline has no way to read a blocked member's name or avatar (the
   * restrictive policy `users_hide_blocked` hides the row from the blocker and no function
   * returns it). Without them the list cannot be shown, so this reports the capability as
   * missing and the screen degrades to its empty state. No call is made.
   */
  listMyBlockedUsers(): Promise<BlockedUser[]> {
    return Promise.reject(new BackendUnavailableError('rpc:list_my_blocked_users', 'function'));
  }
}
