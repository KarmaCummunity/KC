// Row mappers: baseline `chats` / `messages` rows → domain entities.
// Mapped to spec: FR-CHAT-001..013, FR-CHAT-011 (read receipts).
//
// The baseline keeps no per-message status: a message is "read" when another member's
// `chat_members.last_read_at` has reached it. The mappers therefore take that marker as an input.

import type { Chat, Message, MessageKind } from '@kc/domain';
import type { Database } from '../database.types';

type ChatRow = Database['public']['Tables']['chats']['Row'];
type MessageRow = Database['public']['Tables']['messages']['Row'];

/** Columns of `chats` the app reads. */
export const CHAT_COLUMNS =
  'id, kind, direct_user_a, direct_user_b, support_user_id, anchor_post_id, last_message_at, created_at' as const;

/** A chat row as selected with {@link CHAT_COLUMNS}. */
export type ChatRowSlice = Pick<
  ChatRow,
  'id' | 'kind' | 'direct_user_a' | 'direct_user_b' | 'support_user_id' | 'anchor_post_id' | 'last_message_at' | 'created_at'
>;

/** The columns of a `messages` row the mapper reads (an RPC result or a broadcast record). */
export type MessageRowSlice = Pick<
  MessageRow,
  'id' | 'chat_id' | 'sender_id' | 'kind' | 'body' | 'system_payload' | 'media_payload' | 'created_at'
>;

/** One member's read marker, as stored in `chat_members`. */
export interface ReadMarker {
  readonly userId: string;
  readonly lastReadAt: string;
}

/**
 * Maps a chat row. A direct chat lists its pair; a support thread lists the member it belongs
 * to (the staff who answer are not part of the pair). Ride and listing anchors no longer exist:
 * a ride or a listing is a post, so only `anchor_post_id` is set.
 */
export function rowToChat(r: ChatRowSlice): Chat {
  const participantIds: [string | null, string | null] =
    r.kind === 'support' ? [r.support_user_id, null] : [r.direct_user_a, r.direct_user_b];
  return {
    chatId: r.id,
    participantIds,
    anchorPostId: r.anchor_post_id,
    anchorRideId: null,
    anchorListingId: null,
    isSupportThread: r.kind === 'support',
    lastMessageAt: r.last_message_at,
    createdAt: r.created_at,
  };
}

/**
 * When a message was read: the `last_read_at` of the first member other than its sender whose
 * marker has reached the message; null while nobody else has read it (a system message has no
 * sender, so any member's marker counts).
 */
export function readAtFor(
  message: Pick<MessageRowSlice, 'sender_id' | 'created_at'>,
  markers: readonly ReadMarker[],
): string | null {
  const createdMs = Date.parse(message.created_at);
  const reader = markers.find(
    (marker) => marker.userId !== message.sender_id && Date.parse(marker.lastReadAt) >= createdMs,
  );
  return reader?.lastReadAt ?? null;
}

/** Maps a message row; `readAt` is the time another member read it (see {@link readAtFor}). */
export function rowToMessage(r: MessageRowSlice, readAt: string | null = null): Message {
  return {
    messageId: r.id,
    chatId: r.chat_id,
    senderId: r.sender_id,
    kind: r.kind as MessageKind,
    // The domain keeps a non-null body; system and media-only messages have none.
    body: r.body ?? '',
    systemPayload: (r.system_payload ?? null) as Record<string, unknown> | null,
    mediaPayload: (r.media_payload ?? null) as Record<string, unknown> | null,
    status: readAt ? 'read' : 'delivered',
    createdAt: r.created_at,
    deliveredAt: r.created_at,
    readAt,
  };
}
