// Support issue = the member's support thread plus one message with the issue in it.
// Mapped to spec: FR-MOD-002, FR-CHAT-007 AC3.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Chat } from '@kc/domain';
import type { Database } from '../database.types';
import { chatCall } from './mapChatError';
import { openSupportThread } from './supabaseDmChat';

/**
 * The text of the support message. The baseline has no category column, so a chosen category is
 * the first line and the description follows after a blank line.
 */
export function supportIssueBody(category: string | null, description: string): string {
  const topic = category?.trim() ?? '';
  return topic.length > 0 ? `${topic}\n\n${description}` : description;
}

/** Opens (or reuses) the caller's support thread and sends the issue into it. */
export async function submitSupportIssue(
  client: SupabaseClient<Database>,
  category: string | null,
  description: string,
): Promise<Chat> {
  const thread = await openSupportThread(client);
  await chatCall(
    'rpc:send_message',
    client.rpc('send_message', { p_chat_id: thread.chatId, p_body: supportIssueBody(category, description) }),
  );
  return thread;
}
