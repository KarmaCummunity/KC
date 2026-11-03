// DM-only Supabase helpers — keeps SupabaseChatRepository under file cap (TD-118).
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatError } from '@kc/application';
import type { Chat } from '@kc/domain';
import type { Database } from '../database.types';
import { rowToChat } from './rowMappers';
import { mapChatError } from './mapChatError';

type ChatRow = Database['public']['Tables']['chats']['Row'];

export type ChatAnchorInput = { postId?: string; rideId?: string };

/** Support singleton index — see `chats_set_support_thread_flag` + `chats_unique_support_pair`. */
function isUniqueSupportPairViolation(err: {
  code?: string;
  message?: string;
  details?: string;
}): boolean {
  if (err.code !== '23505') return false;
  const blob = `${err.message ?? ''} ${err.details ?? ''}`;
  return blob.includes('chats_unique_support_pair');
}

async function fetchSupportThreadForOrderedPair(
  client: SupabaseClient<Database>,
  a: string,
  b: string,
): Promise<ChatRow | null> {
  const { data, error } = await client
    .from('chats')
    .select('chat_id, participant_a, participant_b, anchor_post_id, anchor_ride_id, anchor_listing_id, is_support_thread, last_message_at, inbox_hidden_at_a, inbox_hidden_at_b, removed_at, created_at')
    .eq('participant_a', a)
    .eq('participant_b', b)
    .eq('is_support_thread', true)
    .maybeSingle();
  if (error) throw mapChatError(error);
  return data;
}

async function maybeReanchorPost(
  client: SupabaseClient<Database>,
  row: ChatRow,
  postId: string,
): Promise<Chat> {
  // One context per chat (0464): a ride or listing anchor also gives way to the post.
  const needsReanchor =
    row.anchor_post_id !== postId || row.anchor_ride_id != null || row.anchor_listing_id != null;
  if (!needsReanchor) return rowToChat(row);

  const { data, error } = await client.rpc('rpc_chat_set_anchor', {
    p_chat_id: row.chat_id,
    p_anchor_post_id: postId,
  });
  if (error) throw mapChatError(error);
  const out = Array.isArray(data) ? data[0] : data;
  return rowToChat((out as ChatRow | undefined) ?? row);
}

async function maybeReanchorRide(
  client: SupabaseClient<Database>,
  row: ChatRow,
  rideId: string,
): Promise<Chat> {
  const needsReanchor =
    row.anchor_ride_id !== rideId || row.anchor_post_id != null || row.anchor_listing_id != null;
  if (!needsReanchor) return rowToChat(row);

  const { data, error } = await client.rpc('rpc_chat_set_anchor_ride', {
    p_chat_id: row.chat_id,
    p_anchor_ride_id: rideId,
  });
  if (error) throw mapChatError(error);
  const out = Array.isArray(data) ? data[0] : data;
  return rowToChat((out as ChatRow | undefined) ?? row);
}

async function maybeReanchorAndReturnChat(
  client: SupabaseClient<Database>,
  row: ChatRow,
  anchor?: ChatAnchorInput,
): Promise<Chat> {
  if (anchor?.postId) return maybeReanchorPost(client, row, anchor.postId);
  if (anchor?.rideId) return maybeReanchorRide(client, row, anchor.rideId);
  return rowToChat(row);
}

function anchorInsertPayload(anchor?: ChatAnchorInput): Pick<ChatRow, 'anchor_post_id' | 'anchor_ride_id'> {
  return {
    anchor_post_id: anchor?.postId ?? null,
    anchor_ride_id: anchor?.rideId ?? null,
  };
}

async function insertDmRowOrReuseSupportThread(
  client: SupabaseClient<Database>,
  a: string,
  b: string,
  anchor?: ChatAnchorInput,
): Promise<Chat> {
  const insert = await client
    .from('chats')
    .insert({
      participant_a: a,
      participant_b: b,
      ...anchorInsertPayload(anchor),
    })
    .select('chat_id, participant_a, participant_b, anchor_post_id, anchor_ride_id, anchor_listing_id, is_support_thread, last_message_at, inbox_hidden_at_a, inbox_hidden_at_b, removed_at, created_at')
    .single();

  if (!insert.error) return rowToChat(insert.data);

  if (isUniqueSupportPairViolation(insert.error)) {
    const support = await fetchSupportThreadForOrderedPair(client, a, b);
    if (support) return maybeReanchorAndReturnChat(client, support, anchor);
  }

  throw mapChatError(insert.error);
}

export async function findOrCreateDmChat(
  client: SupabaseClient<Database>,
  userId: string,
  otherUserId: string,
  anchor?: ChatAnchorInput,
  options?: { preferNewThread?: boolean },
): Promise<Chat> {
  const { data: otherRow, error: otherErr } = await client
    .from('users')
    .select('user_id')
    .eq('user_id', otherUserId)
    .maybeSingle();
  if (otherErr) throw mapChatError(otherErr);
  if (!otherRow) {
    throw new ChatError('send_to_deleted_user', 'counterpart_not_found');
  }

  const [a, b] =
    userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];

  if (options?.preferNewThread) {
    return insertDmRowOrReuseSupportThread(client, a, b, anchor);
  }

  const list = await client
    .from('chats')
    .select('chat_id, participant_a, participant_b, anchor_post_id, anchor_ride_id, anchor_listing_id, is_support_thread, last_message_at, inbox_hidden_at_a, inbox_hidden_at_b, removed_at, created_at')
    .eq('participant_a', a)
    .eq('participant_b', b)
    .eq('is_support_thread', false)
    .order('last_message_at', { ascending: false })
    .limit(50);
  if (list.error) throw mapChatError(list.error);

  const rows = list.data ?? [];
  const viewerIsA = userId === a;
  const visible = rows.find((r) =>
    viewerIsA ? r.inbox_hidden_at_a == null : r.inbox_hidden_at_b == null,
  );

  if (visible) {
    return maybeReanchorAndReturnChat(client, visible, anchor);
  }

  return insertDmRowOrReuseSupportThread(client, a, b, anchor);
}

export async function hideDmChatFromInbox(
  client: SupabaseClient<Database>,
  chatId: string,
): Promise<void> {
  const { error } = await client.rpc('rpc_chat_hide_for_viewer', {
    p_chat_id: chatId,
  });
  if (error) throw mapChatError(error);
}
