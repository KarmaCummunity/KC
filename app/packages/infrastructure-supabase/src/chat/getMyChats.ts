// The caller's inbox: one `chat_inbox_page` call returns every row with its counterpart, the
// newest message preview and the unread count. The server already hides chats the caller hid,
// hides blocked pairs and keeps one chat per pair, so nothing is deduplicated here.
// Mapped to spec: FR-CHAT-001 (conversation list), FR-CHAT-006, FR-CHAT-016.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatWithPreview } from '@kc/application';
import { toVerificationLevel, type Message, type MessageKind } from '@kc/domain';
import type { Database } from '../database.types';
import { chatCall } from './mapChatError';

type InboxRow = Database['public']['Functions']['chat_inbox_page']['Returns'][number];

/** The largest page `chat_inbox_page` serves (the server clamps larger requests to 50). */
const INBOX_PAGE_SIZE = 50;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The newest message as the inbox shows it. The page carries a 140-character preview of the
 * body, the kind and the sender, the system payload of a system message and the media type of a
 * media message (its only media field the preview needs), not the full row.
 */
function previewMessage(row: InboxRow): Message | null {
  if (!row.last_message_id) return null;
  return {
    messageId: row.last_message_id,
    chatId: row.chat_id,
    senderId: row.last_message_sender_id,
    kind: row.last_message_kind as MessageKind,
    body: row.last_message_preview ?? '',
    systemPayload: isObject(row.last_message_system_payload) ? row.last_message_system_payload : null,
    mediaPayload: row.last_message_media_type ? { type: row.last_message_media_type } : null,
    status: 'delivered',
    createdAt: row.last_message_at,
    deliveredAt: row.last_message_at,
    readAt: null,
  };
}

/**
 * Maps one inbox row. A direct chat whose counterpart is gone (inactive or deleted) has a null
 * `counterpart_id` and renders as a deleted user; the member's own support thread has no
 * counterpart either, but it is not a deleted one. The page has no creation time, so `createdAt`
 * repeats the newest message time (the inbox does not read it).
 */
function rowToPreview(row: InboxRow, viewerId: string): ChatWithPreview {
  const isSupport = row.kind === 'support';
  const counterpartId = row.counterpart_id;
  return {
    chatId: row.chat_id,
    participantIds: [viewerId, counterpartId],
    anchorPostId: row.anchor_post_id,
    isSupportThread: isSupport,
    lastMessageAt: row.last_message_at,
    createdAt: row.last_message_at,
    otherParticipant: {
      userId: counterpartId,
      displayName: row.counterpart_display_name,
      avatarUrl: row.counterpart_avatar_url,
      shareHandle: row.counterpart_share_handle,
      isDeleted: counterpartId === null && !isSupport,
      verificationLevel: toVerificationLevel(row.counterpart_verification_level),
    },
    lastMessage: previewMessage(row),
    unreadCount: Number(row.unread_count),
  };
}

/** The caller's newest chats (one page of at most 50), newest message first. */
export async function getMyChats(client: SupabaseClient<Database>, userId: string): Promise<ChatWithPreview[]> {
  const rows = await chatCall(
    'rpc:chat_inbox_page',
    client.rpc('chat_inbox_page', { p_limit: INBOX_PAGE_SIZE }),
  );
  return (rows ?? []).map((row) => rowToPreview(row, userId));
}
