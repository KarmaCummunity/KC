// Support issue = one `support_issue` system message in the member's support thread.
// Mapped to spec: FR-MOD-002 AC2–AC6, FR-CHAT-007 AC3.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Chat } from '@kc/domain';
import type { Database } from '../database.types';
import { chatCall, requireRow } from './mapChatError';
import { rowToChat, type ChatRowSlice } from './rowMappers';

/**
 * Files the issue through `submit_support_issue` (migration 0015): the server opens or reuses the
 * caller's support thread, writes the category and description as a system message with a stable
 * issue id, refuses a description outside 10..500 characters, and returns the thread.
 */
export async function submitSupportIssue(
  client: SupabaseClient<Database>,
  category: string | null,
  description: string,
): Promise<Chat> {
  // No category is sent as an empty one; the server reads a blank category as none.
  const data = await chatCall(
    'rpc:submit_support_issue',
    client.rpc('submit_support_issue', {
      p_category: category?.trim() ?? '',
      p_description: description,
    }),
  );
  const row = (Array.isArray(data) ? data[0] : data) as ChatRowSlice | null | undefined;
  return rowToChat(requireRow(row, 'submit_support_issue'));
}
