import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;
type Mode = 'assign' | 'close_without';

/** FR-CLOSURE-011 — `owner_complete_offer_with_user` (0658). */
export async function ownerCompleteOffer(
  client: Client,
  targetId: string,
  recipientUserId: string | null,
  mode: Mode,
): Promise<{ closed: boolean }> {
  const { data, error } = await client.rpc('owner_complete_offer_with_user', {
    p_target: targetId,
    p_recipient_id: recipientUserId ?? undefined,
    p_mode: mode,
  });
  if (error) throw error;
  const closed = typeof data === 'object' && data !== null && 'closed' in data
    ? Boolean((data as { closed?: boolean }).closed)
    : false;
  return { closed };
}
