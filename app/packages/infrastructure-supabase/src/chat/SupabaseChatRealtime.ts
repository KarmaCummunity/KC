// Supabase adapter for IChatRealtime over private Broadcast topics only (no postgres_changes):
//   chat:<chat id>:messages  INSERT (the message row) · read · chat_updated
//   user:<user id>:chats     chat_updated (ids only: the member's inbox or badge changed)
// who may join is decided by the policies in supabase/schemas/40_messaging/060_realtime.sql;
// a chat topic is open to the members who can currently use the chat (FR-CHAT-009 carve-out).
//
// Mapped to spec: FR-CHAT-003 (≤500ms p95), FR-CHAT-011, FR-CHAT-012.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IChatRealtime, InboxStreamCallbacks, SubscribeInboxOptions, ChatStreamCallbacks, Unsubscribe } from '@kc/application';
import type { Database } from '../database.types';
import { rowToMessage, type MessageRowSlice } from './rowMappers';
import { isChannelFailure, openExactTopicChannel } from '../realtime/exactTopicChannel';
import { unwrapCall } from '../rpc/mapRpcError';

/** `realtime.send` payload of the messages trigger → the inserted row (null when absent). */
export function broadcastRecord(msg: { [key: string]: unknown }): Record<string, unknown> | null {
  const p = msg?.payload as { record?: Record<string, unknown> } | undefined;
  return p?.record && typeof p.record === 'object' ? p.record : null;
}

/** The payload of a broadcast event as a plain object (empty when it is not one). */
function payloadOf(msg: { [key: string]: unknown }): Record<string, unknown> {
  const p = msg?.payload;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Delay that folds a burst of `chat_updated` events into one unread-total read. */
const UNREAD_DEBOUNCE_MS = 200;

export class SupabaseChatRealtime implements IChatRealtime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Listens to one chat: new messages, the other member's read marker (the receipt) and a change
   * of the pinned post. Reactions arrive on the same topic as `reaction` and are not consumed here.
   */
  subscribeToChat(chatId: string, cb: ChatStreamCallbacks): Unsubscribe {
    const managed = openExactTopicChannel(
      this.client,
      `chat:${chatId}:messages`,
      { private: true },
      (channel) => {
        channel.on('broadcast', { event: 'INSERT' }, (msg) => {
          const row = broadcastRecord(msg);
          if (row) cb.onMessage(rowToMessage(row as unknown as MessageRowSlice));
        });
        channel.on('broadcast', { event: 'read' }, (msg) => {
          const { user_id: userId, last_read_at: lastReadAt } = payloadOf(msg);
          if (typeof userId === 'string' && typeof lastReadAt === 'string') cb.onReadMarker({ userId, lastReadAt });
        });
        channel.on('broadcast', { event: 'chat_updated' }, (msg) => {
          cb.onChatChanged?.({ chatId, anchorPostId: asString(payloadOf(msg)['anchor_post_id']) });
        });
      },
      (status) => {
        if (isChannelFailure(status)) cb.onError(new Error(`chat channel ${status.toLowerCase()}`));
      },
    );
    return () => managed.close();
  }

  /**
   * Listens to the member's inbox topic. The event carries ids only, so every event tells the
   * inbox to refresh and, debounced, re-reads the unread total (the result is dropped when the
   * snapshot epoch moved meanwhile, FR-CHAT-012 race with mark-read).
   */
  subscribeToInbox(userId: string, cb: InboxStreamCallbacks, options?: SubscribeInboxOptions): Unsubscribe {
    let unreadTimer: ReturnType<typeof setTimeout> | null = null;
    const fireUnreadDebounced = () => {
      if (unreadTimer) clearTimeout(unreadTimer);
      unreadTimer = setTimeout(() => void this.readUnreadTotal(cb, options), UNREAD_DEBOUNCE_MS);
    };

    const managed = openExactTopicChannel(
      this.client,
      `user:${userId}:chats`,
      { private: true },
      (channel) => {
        channel.on('broadcast', { event: 'chat_updated' }, (msg) => {
          const payload = payloadOf(msg);
          cb.onInboxChanged({ chatId: asString(payload['chat_id']), lastMessageAt: asString(payload['last_message_at']) });
          fireUnreadDebounced();
        });
      },
    );

    return () => {
      if (unreadTimer) clearTimeout(unreadTimer);
      managed.close();
    };
  }

  /** Reads `chat_unread_total` and reports it unless the snapshot epoch moved or the call failed. */
  private async readUnreadTotal(cb: InboxStreamCallbacks, options?: SubscribeInboxOptions): Promise<void> {
    const epoch = options?.getSnapshotEpoch;
    const before = epoch?.() ?? 0;
    try {
      const total = unwrapCall('rpc:chat_unread_total', await this.client.rpc('chat_unread_total'));
      if (epoch && epoch() !== before) return;
      cb.onUnreadTotalChanged(Number(total ?? 0));
    } catch {
      // The badge is refreshed again on the next event or on focus; a failed read changes nothing.
    }
  }
}
