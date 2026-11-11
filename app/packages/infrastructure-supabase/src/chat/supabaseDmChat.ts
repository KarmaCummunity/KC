// Direct-chat and support-thread helpers over the baseline RPCs (kept apart from the repository
// class for the file-size cap, TD-118).
// Mapped to spec: FR-CHAT-004 (anchoring), FR-CHAT-006, FR-CHAT-007, FR-CHAT-016.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Chat } from '@kc/domain';
import type { Database } from '../database.types';
import { rowToChat, type ChatRowSlice } from './rowMappers';
import { chatCall, requireRow } from './mapChatError';

/** The post a chat is opened from (a ride or a listing is a post). */
export type ChatAnchorInput = { postId?: string };

/** An RPC that returns one `chats` row may surface it bare or as a one-element array. */
function singleChatRow(data: unknown, rpcName: string): ChatRowSlice {
  return requireRow((Array.isArray(data) ? data[0] : data) as ChatRowSlice | null | undefined, rpcName);
}

/**
 * The caller's one direct chat with `otherUserId`, created when missing and un-hidden from the
 * caller's inbox. Passing an anchor pins the chat to that post (the server rejects a post that
 * is not open or belongs to neither member).
 */
export async function openDirectChat(
  client: SupabaseClient<Database>,
  otherUserId: string,
  anchor?: ChatAnchorInput,
): Promise<Chat> {
  const data = await chatCall(
    'rpc:open_direct_chat',
    client.rpc('open_direct_chat', {
      p_user_id: otherUserId,
      p_anchor_post_id: anchor?.postId,
    }),
  );
  return rowToChat(singleChatRow(data, 'open_direct_chat'));
}

/** The caller's support thread; the server creates it on first use. */
export async function openSupportThread(client: SupabaseClient<Database>): Promise<Chat> {
  const data = await chatCall('rpc:open_support_thread', client.rpc('open_support_thread'));
  return rowToChat(singleChatRow(data, 'open_support_thread'));
}

/** Hides a chat from the caller's inbox until its next message (a support thread cannot be hidden). */
export async function hideChat(client: SupabaseClient<Database>, chatId: string): Promise<void> {
  await chatCall('rpc:hide_chat', client.rpc('hide_chat', { p_chat_id: chatId }));
}
