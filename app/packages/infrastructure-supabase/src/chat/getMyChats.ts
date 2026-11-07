// Conversations list with last-message preview + unread counts.
// Three queries (chats + messages + users) reconciled in TS — simpler against
// generated types than a LATERAL join, and adequate for MVP load.
// Mapped to SRS: FR-CHAT-001 (conversation list), FR-CHAT-006, FR-CHAT-016.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatWithPreview } from '@kc/application';
import { toVerificationLevel, type Message, type VerificationLevel } from '@kc/domain';
import type { Database } from '../database.types';
import { rowToChat, rowToMessage } from './rowMappers';
import { mapChatError } from './mapChatError';

type ChatRow = Database['public']['Tables']['chats']['Row'];

export function isVisibleInInboxForViewer(r: ChatRow, userId: string): boolean {
  if (r.participant_a === userId) return r.inbox_hidden_at_a == null;
  if (r.participant_b === userId) return r.inbox_hidden_at_b == null;
  return false;
}

export function counterpartId(r: ChatRow, userId: string): string | null {
  return r.participant_a === userId ? r.participant_b : r.participant_a;
}

/**
 * One row per human counterpart — highest last_message_at wins (FR-CHAT-016).
 *
 * TD-110 bug 3: when `counterpartId` returns null (counterpart user deleted),
 * the previous implementation collapsed every deleted-counterpart chat to a
 * single `'__deleted__'` bucket — multiple distinct threads with different
 * deleted users appeared as one row. Each deleted-counterpart chat is with a
 * *different* user, so we key by `chat_id` in that case to keep them
 * separate. Active counterparts continue to dedupe by user_id as before.
 */
export function dedupeRowsByCounterpart(userId: string, rows: ChatRow[]): ChatRow[] {
  const best = new Map<string, ChatRow>();
  for (const r of rows) {
    const counterpart = counterpartId(r, userId);
    const other = counterpart ?? `__deleted__:${r.chat_id}`;
    const prev = best.get(other);
    if (!prev) {
      best.set(other, r);
      continue;
    }
    const ts = Date.parse(r.last_message_at);
    const pts = Date.parse(prev.last_message_at);
    if (ts > pts || (ts === pts && r.chat_id > prev.chat_id)) best.set(other, r);
  }
  return [...best.values()];
}

export async function getMyChats(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<ChatWithPreview[]> {
  const chatsRes = await client
    .from('chats')
    .select('chat_id, participant_a, participant_b, anchor_post_id, anchor_ride_id, anchor_listing_id, is_support_thread, last_message_at, inbox_hidden_at_a, inbox_hidden_at_b, removed_at, created_at')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order('last_message_at', { ascending: false })
    .limit(50);
  if (chatsRes.error) throw mapChatError(chatsRes.error);

  const raw = (chatsRes.data ?? []) as ChatRow[];
  const visible = raw.filter((r) => isVisibleInInboxForViewer(r, userId));
  const rows = dedupeRowsByCounterpart(userId, visible);

  const chats = rows.map(rowToChat);
  if (chats.length === 0) return [];

  const chatIds = chats.map((c) => c.chatId);

  const msgsRes = await client
    .from('messages')
    .select('message_id, chat_id, sender_id, body, kind, system_payload, status, created_at, delivered_at, read_at')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false })
    .limit(500);
  if (msgsRes.error) throw mapChatError(msgsRes.error);
  const lastMessageByChat = new Map<string, Message>();
  for (const m of (msgsRes.data ?? []).map(rowToMessage)) {
    if (!lastMessageByChat.has(m.chatId)) lastMessageByChat.set(m.chatId, m);
  }

  // PERF-5: server-side per-chat unread count. Replaces the prior fan-out
  // (SELECT every non-read message + group client-side) which was the
  // worst payload offender in this query family — for heavy chat users it
  // pulled tens of MB just to compute small integers.
  const unreadRes = await client.rpc('rpc_unread_counts_for_chats', {
    p_viewer_id: userId,
    p_chat_ids: chatIds,
  });
  if (unreadRes.error) throw mapChatError(unreadRes.error);
  const unreadByChat: Record<string, number> = {};
  for (const r of unreadRes.data ?? []) {
    unreadByChat[r.chat_id] = r.unread_count;
  }

  const otherIds = chats
    .map((c) => (c.participantIds[0] === userId ? c.participantIds[1] : c.participantIds[0]))
    .filter((id): id is string => id != null);
  const usersRes = await client
    .from('users')
    .select('user_id, display_name, avatar_url, share_handle, verification_level')
    .in('user_id', otherIds);
  if (usersRes.error) throw mapChatError(usersRes.error);
  const userMap = new Map<
    string,
    {
      displayName: string | null;
      avatarUrl: string | null;
      shareHandle: string | null;
      verificationLevel: VerificationLevel;
    }
  >();
  for (const u of usersRes.data ?? []) {
    userMap.set(u.user_id, {
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      shareHandle: u.share_handle,
      verificationLevel: toVerificationLevel(u.verification_level),
    });
  }

  const list = chats.map((c) => {
    const otherId =
      c.participantIds[0] === userId ? c.participantIds[1] : c.participantIds[0];
    const found = otherId != null ? userMap.get(otherId) : null;
    return {
      ...c,
      otherParticipant:
        found && otherId != null
          ? {
              userId: otherId,
              displayName: found.displayName,
              avatarUrl: found.avatarUrl,
              shareHandle: found.shareHandle,
              isDeleted: false,
              verificationLevel: found.verificationLevel,
            }
          : {
              userId: null,
              displayName: null,
              avatarUrl: null,
              shareHandle: null,
              isDeleted: true,
            },
      lastMessage: lastMessageByChat.get(c.chatId) ?? null,
      unreadCount: unreadByChat[c.chatId] ?? 0,
    };
  });
  return list.sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return tb - ta;
  });
}
