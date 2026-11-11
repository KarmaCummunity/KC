// Direct updates of the caller's own public profile row (`grant update (display_name, biography,
// avatar_url, city_id, preferred_language) on users`, policy `users_update_self`).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** The columns a member may update on `users`; the privacy mode moves through `set_privacy_mode`. */
export type UserProfilePatch = Pick<
  Database['public']['Tables']['users']['Update'],
  'avatar_url' | 'biography' | 'city_id' | 'display_name' | 'preferred_language'
>;

/** Updates the caller's `users` row; `userId` is the caller (RLS refuses any other row). */
export async function updateOwnUser(
  client: SupabaseClient<Database>,
  userId: string,
  patch: UserProfilePatch,
): Promise<void> {
  unwrapCall('table:users', await client.from('users').update(patch).eq('id', userId));
}
