// KC#873 — chat typing indicator: client Broadcast on the private `chat:<id>:typing` topic. The
// database policy lets the members of a chat, and only them, join and send on it
// (supabase/schemas/40_messaging/060_realtime.sql). Online presence: SupabaseOnlinePresence.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { isChannelFailure, openExactTopicChannel } from '../realtime/exactTopicChannel';

export type TypingCallbacks = {
  onPeerTyping?: (payload: { userId: string; typing: boolean }) => void;
  onError?: (err: Error) => void;
};

export type TypingSubscription = {
  sendTyping: (typing: boolean) => void;
  unsubscribe: () => void;
};

export const TYPING_THROTTLE_MS = 800;

export class SupabaseChatV2Realtime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  subscribeTyping(chatId: string, userId: string, cb: TypingCallbacks): TypingSubscription {
    let lastSent = 0;
    let lastTyping = false;
    let live: RealtimeChannel | null = null;
    let closed = false;

    const managed = openExactTopicChannel(
      this.client,
      `chat:${chatId}:typing`,
      { private: true, broadcast: { self: false } },
      (ch) => {
        ch.on('broadcast', { event: 'typing' }, (msg) => {
          const p = msg.payload as { userId?: string; typing?: boolean } | undefined;
          if (!p?.userId || p.userId === userId) return;
          cb.onPeerTyping?.({ userId: p.userId, typing: !!p.typing });
        });
      },
      (status) => {
        if (isChannelFailure(status)) cb.onError?.(new Error(`typing channel ${status.toLowerCase()}`));
      },
    );
    void managed.ready.then((ch) => {
      live = ch;
    });

    const sendTyping = (typing: boolean) => {
      if (closed || !live) return;
      const now = Date.now();
      // Throttle repeated "typing"; "stopped" only matters after a "typing".
      if (typing && now - lastSent < TYPING_THROTTLE_MS) return;
      if (!typing && !lastTyping) return;
      lastSent = now;
      lastTyping = typing;
      void live.send({ type: 'broadcast', event: 'typing', payload: { userId, typing } });
    };

    return {
      sendTyping,
      unsubscribe: () => {
        if (closed) return;
        sendTyping(false);
        closed = true;
        live = null;
        managed.close();
      },
    };
  }
}
