// "Show my active status": the owner-only flag `user_private.show_active_status`, read and written
// on the caller's own row (column grant + policy `user_private_update_self`). Realtime
// Authorization enforces it for presence (no track, no receive when off).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { updateUserPrivate } from './ownPrivateUpdate';
import { sessionUserId } from './userReads';

export class SupabaseActiveStatusRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Defaults to true (the column default) when the row is missing or nobody is signed in. */
  async get(): Promise<boolean> {
    const userId = await sessionUserId(this.client);
    if (!userId) return true;
    const row = unwrapCall(
      'table:user_private',
      await this.client.from('user_private').select('show_active_status').eq('user_id', userId).maybeSingle(),
    );
    return row?.show_active_status !== false;
  }

  /** Stores the flag and returns it. */
  async set(enabled: boolean): Promise<boolean> {
    const userId = await sessionUserId(this.client);
    if (!userId) throw new Error('setShowActiveStatus: not signed in');
    await updateUserPrivate(this.client, userId, { show_active_status: enabled });
    return enabled;
  }
}
