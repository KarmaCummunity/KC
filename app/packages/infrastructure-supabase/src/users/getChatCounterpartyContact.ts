import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/**
 * FR-CHAT-014 AC7 — the counterpart's contact phone through `chat_counterpart_contact`. The
 * server answers null when the caller cannot use the chat, it is a support thread, the
 * counterpart is inactive or has no phone.
 */
export async function getChatCounterpartyContact(
  client: SupabaseClient<Database>,
  chatId: string,
): Promise<string | null> {
  const phone = unwrapCall(
    'rpc:chat_counterpart_contact',
    await client.rpc('chat_counterpart_contact', { p_chat_id: chatId }),
  );
  const trimmed = phone?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
