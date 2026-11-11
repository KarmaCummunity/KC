// Loads chat metadata + counterpart, kicks off the message subscription, and
// clears unread on entry. Extracted from chat/[id].tsx to keep that screen
// under the architecture LOC cap (TD-118 target: drop allowlist entry).
//
// Three independent network paths fan out in parallel — strict-serial awaits
// here used to compound into a visible first-paint delay on web.
//   1. chat row → counterpart (counterpart depends on chat.participantIds)
//   2. messages (via startThreadSub) — populates the bubble list
//   3. mark-read RPC + local badge clear
import { useEffect, useState } from 'react';
import type { Chat, VerificationLevel } from '@kc/domain';
import { useChatStore } from '../store/chatStore';
import { container } from '../lib/container';

export interface ChatCounterpart {
  userId: string | null;
  displayName: string | null;
  shareHandle: string | null;
  isDeleted: boolean;
  verificationLevel?: VerificationLevel;
}

const EMPTY_COUNTERPART: ChatCounterpart = {
  userId: null,
  displayName: '',
  shareHandle: null,
  isDeleted: false,
};

/** Audit §14.4 — three-state load:
 *  - 'loading' = findById in flight (first paint)
 *  - 'not_found' = findById resolved with null (chat doesn't exist or RLS hid it)
 *  - 'loaded' = chat row available; subscription has started
 *  Consumer renders an EmptyState on 'not_found' instead of an empty header+bubble list. */
export type ChatInitStatus = 'loading' | 'not_found' | 'loaded';

export function useChatInit(chatId: string, userId: string) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [counterpart, setCounterpart] = useState<ChatCounterpart>(EMPTY_COUNTERPART);
  const [status, setStatus] = useState<ChatInitStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    void (async () => {
      const c = await container.chatRepo.findById(chatId);
      if (cancelled) return;
      if (!c) {
        setStatus('not_found');
        return;
      }
      const cp = await container.chatRepo.getCounterpart(c, userId);
      if (cancelled) return;
      setChat(c);
      setCounterpart({
        userId: cp.userId,
        displayName: cp.displayName,
        shareHandle: cp.shareHandle,
        isDeleted: cp.isDeleted,
        verificationLevel: cp.verificationLevel,
      });
      setStatus('loaded');

      // Subscribe only once we know the chat exists. A subscription on a
      // never-fires channel (RLS-hidden chat id) used to spin the empty UI
      // forever with no diagnostic.
      void useChatStore
        .getState()
        .startThreadSub(chatId, container.chatRepo, container.chatRealtime, (change) => {
          if (!cancelled) setChat((prev) => (prev ? { ...prev, anchorPostId: change.anchorPostId } : prev));
        });

      try {
        await container.markChatRead.execute({ chatId, userId });
        if (!cancelled) useChatStore.getState().markChatLocallyRead(chatId);
      } catch {
        /* read-state lag is recoverable; realtime will reconcile */
      }
    })();

    return () => {
      cancelled = true;
      useChatStore.getState().stopThreadSub(chatId);
    };
  }, [chatId, userId]);

  return { chat, counterpart, status };
}
