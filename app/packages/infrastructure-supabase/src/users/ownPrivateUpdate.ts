// Direct updates of the caller's own `user_private` row (column grants and policy
// `user_private_update_self` limit them to the member's own preferences and profile details).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** The columns a member may update (`grant update (...) on user_private`). */
export type UserPrivatePatch = Pick<
  Database['public']['Tables']['user_private']['Update'],
  | 'basic_info_skipped'
  | 'closure_explainer_dismissed'
  | 'contact_phone'
  | 'first_post_nudge_dismissed'
  | 'notification_preferences'
  | 'profile_street'
  | 'profile_street_number'
  | 'show_active_status'
>;

/** Updates the caller's `user_private` row; `userId` is the caller (RLS refuses any other row). */
export async function updateUserPrivate(
  client: SupabaseClient<Database>,
  userId: string,
  patch: UserPrivatePatch,
): Promise<void> {
  unwrapCall('table:user_private', await client.from('user_private').update(patch).eq('user_id', userId));
}
