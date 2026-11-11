// Supabase adapter for IChatRealtime. Per-chat messages use the private
// Broadcast topic from 0259; chat rows use postgres_changes (chats is on the
// supabase_realtime publication; messages is not, see 0349).
//
// RLS filters server-side: clients only receive events for rows they can SELECT,
// preserving the FR-CHAT-009 carve-out.
//
// Mapped to SRS: FR-CHAT-003 (≤500ms p95), FR-CHAT-011, FR-CHAT-012.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IChatRealtime,
  InboxStreamCallbacks,
  SubscribeInboxOptions,
  ChatStreamCallbacks,
  Unsubscribe,
} from '@kc/application';
import type { Database } from '../database.legacy.types';
import { rowToChat, rowToMessage } from './rowMappers';
import { isChannelFailure, openExactTopicChannel, uniqueTopicSuffix } from '../realtime/exactTopicChannel';

/** `realtime.broadcast_changes` payload → the changed row (null when absent). */
export function broadcastRecord(msg: { [key: string]: unknown }): Record<string, unknown> | null {
  const p = msg?.payload as { record?: Record<string, unknown> } | undefined;
  return p?.record && typeof p.record === 'object' ? p.record : null;
}

const UNREAD_DEBOUNCE_MS = 200;

export class SupabaseChatRealtime implements IChatRealtime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  subscribeToChat(chatId: string, cb: ChatStreamCallbacks): Unsubscribe {
    // Messages arrive via the 0259 Broadcast trigger on the private
    // `chat:<id>:messages` topic (messages is off the publication since 0349).
    // INSERT → new message; UPDATE → delivered/read receipts.
    const messages = openExactTopicChannel(
      this.client,
      `chat:${chatId}:messages`,
      { private: true },
      (ch) => {
        ch.on('broadcast', { event: 'INSERT' }, (msg) => {
          const row = broadcastRecord(msg);
          if (row) cb.onMessage(rowToMessage(row as never));
        });
        ch.on('broadcast', { event: 'UPDATE' }, (msg) => {
          const row = broadcastRecord(msg);
          if (!row) return;
          const m = rowToMessage(row as never);
          cb.onMessageStatusChanged({
            messageId: m.messageId,
            status: m.status,
            deliveredAt: m.deliveredAt,
            readAt: m.readAt,
          });
        });
      },
      (status) => {
        if (isChannelFailure(status)) cb.onError(new Error(`chat channel ${status.toLowerCase()}`));
      },
    );

    // chats stays on the publication; unique suffix avoids cached-channel reuse.
    const chatTopic = `chat-row:${chatId}:${uniqueTopicSuffix()}`;
    const chatRow = cb.onChatChanged
      ? this.client
          .channel(chatTopic)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'chats', filter: `chat_id=eq.${chatId}` },
            (payload) => cb.onChatChanged?.(rowToChat(payload.new as never)),
          )
          .subscribe()
      : null;

    return () => {
      messages.close();
      if (chatRow) void this.client.removeChannel(chatRow);
    };
  }

  subscribeToInbox(userId: string, cb: InboxStreamCallbacks, options?: SubscribeInboxOptions): Unsubscribe {
    let unreadTimer: ReturnType<typeof setTimeout> | null = null;
    const fireUnreadDebounced = () => {
      if (unreadTimer) clearTimeout(unreadTimer);
      unreadTimer = setTimeout(async () => {
        const getE = options?.getSnapshotEpoch;
        const e0 = getE?.() ?? 0;
        const { data, error } = await this.client.rpc('rpc_chat_unread_total');
        if (getE && getE() !== e0) return;
        if (!error) cb.onUnreadTotalChanged(Number(data ?? 0));
      }, UNREAD_DEBOUNCE_MS);
    };

    const inboxTopic = `inbox:${userId}:${uniqueTopicSuffix()}`;
    const channel = this.client
      .channel(inboxTopic)
      // RLS filters server-side: only events on visible chats reach the client.
      // A new message bumps chats.last_message_at, so chat UPDATEs also drive
      // the unread total (messages itself is Broadcast-only since 0349).
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chats' },
        (payload) => {
          cb.onChatChanged(rowToChat(payload.new as never));
          fireUnreadDebounced();
        },
      )
      .subscribe();

    return () => {
      if (unreadTimer) clearTimeout(unreadTimer);
      void this.client.removeChannel(channel);
    };
  }
}
