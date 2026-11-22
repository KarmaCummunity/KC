// Loads chat metadata + counterpart and kicks off the message subscription for the conversation
// screen (FR-CHAT-002). Extracted from chat/[id].tsx to keep that screen under the architecture
// LOC cap (TD-118).
//
// Opening a chat used to await every call in turn (chat row → counterpart → messages), so the
// messages appeared only after three round-trips and the header name after two (#2566). Now:
//   0. First frame: the chat and its counterpart come from the cached inbox when the chat is in
//      it (`chatOpenSeedFromInbox`), so the header is painted before any request returns.
//   1. The messages page and its realtime channel start at once (`startThreadSub`).
//   2. The chat row is revalidated in parallel; when it is missing (deleted, or hidden by a
//      block) the screen shows its not-found state and the subscription is stopped.
//   3. The counterpart is revalidated in parallel with (2) when the seed already names it, and
//      after (2) otherwise, since only the chat row tells who the counterpart is.
// Marking the chat read is owned by `useMarkChatRead`, so entry sends it at most once.
import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '@kc/domain';
import type { IChatRepository } from '@kc/application';
import { useChatStore } from '../store/chatStore';
import { container } from '../lib/container';
import { queryClient } from '../lib/queryPersist';
import { readChatInboxSnapshot } from '../lib/chatInboxQuery';
import { chatOpenSeedFromInbox, type ChatCounterpart } from '../lib/chatOpenSeed';
import { reportHandledError } from '../lib/observability/reportHandledError';

export type { ChatCounterpart } from '../lib/chatOpenSeed';

/** Shown while nothing is known yet: an empty title rather than the deleted-user placeholder. */
const EMPTY_COUNTERPART: ChatCounterpart = {
  userId: null,
  displayName: '',
  shareHandle: null,
  isDeleted: false,
};

/** Sentry key of a failed open request; the screen keeps whatever it already shows. */
const OPEN_ERROR_KEY = ['chat', 'open'] as const;

/** Audit §14.4 — three-state load:
 *  - 'loading' = nothing known about the chat yet (no inbox seed, chat row in flight)
 *  - 'not_found' = the chat row resolved to null (chat doesn't exist or RLS hid it)
 *  - 'loaded' = a chat is available, from the inbox seed or the server
 *  Consumer renders an EmptyState on 'not_found' instead of an empty header+bubble list. */
export type ChatInitStatus = 'loading' | 'not_found' | 'loaded';

/**
 * What the server returned for one chat. `chat` is undefined until the row arrives and null
 * when it does not exist. Tagged with its chat id so a result for a previous route param is
 * never shown for the next one.
 */
interface FetchedChat {
  readonly chatId: string;
  readonly chat?: Chat | null;
  readonly counterpart?: ChatCounterpart;
}

/** The counterpart fields the header reads, from the repository's richer result. */
function toChatCounterpart(cp: Awaited<ReturnType<IChatRepository['getCounterpart']>>): ChatCounterpart {
  return {
    userId: cp.userId,
    displayName: cp.displayName,
    shareHandle: cp.shareHandle,
    isDeleted: cp.isDeleted,
    verificationLevel: cp.verificationLevel,
  };
}

export function useChatInit(chatId: string, userId: string) {
  // Read once per chat: later inbox updates must not re-run the open requests, and the network
  // result replaces the seed as soon as it lands.
  const seed = useMemo(
    () => chatOpenSeedFromInbox(readChatInboxSnapshot(queryClient, userId), chatId),
    [chatId, userId],
  );
  const [fetched, setFetched] = useState<FetchedChat>({ chatId });

  useEffect(() => {
    let cancelled = false;
    const { chatRepo, chatRealtime } = container;

    /** Merges a server result into the state of this chat (drops a state left from another chat). */
    const apply = (patch: (current: FetchedChat) => Partial<FetchedChat>) =>
      setFetched((prev) => {
        const current = prev.chatId === chatId ? prev : { chatId };
        return { ...current, ...patch(current) };
      });

    const loadCounterpart = (chat: Chat) =>
      chatRepo.getCounterpart(chat, userId).then((cp) => {
        if (!cancelled) apply(() => ({ counterpart: toChatCounterpart(cp) }));
      });

    // (1) Messages + realtime. The pinned post can change while the screen is open (FR-CHAT-014).
    useChatStore
      .getState()
      .startThreadSub(chatId, chatRepo, chatRealtime, (change) => {
        if (cancelled) return;
        apply((current) => {
          const chat = current.chat ?? seed?.chat;
          return chat ? { chat: { ...chat, anchorPostId: change.anchorPostId } } : {};
        });
      })
      .catch((error: unknown) => reportHandledError(error, 'manual', OPEN_ERROR_KEY));

    // (3, seeded) The seed already names the counterpart: refresh it alongside the chat row.
    if (seed) loadCounterpart(seed.chat).catch((error: unknown) => reportHandledError(error, 'manual', OPEN_ERROR_KEY));

    // (2) The chat row decides between the conversation and the not-found state.
    chatRepo
      .findById(chatId)
      .then((chat) => {
        if (cancelled) return undefined;
        apply(() => ({ chat }));
        if (!chat) {
          // A channel on a chat the caller cannot see never fires; do not keep it open.
          useChatStore.getState().stopThreadSub(chatId);
          return undefined;
        }
        return seed ? undefined : loadCounterpart(chat);
      })
      .catch((error: unknown) => reportHandledError(error, 'manual', OPEN_ERROR_KEY));

    return () => {
      cancelled = true;
      useChatStore.getState().stopThreadSub(chatId);
    };
  }, [chatId, userId, seed]);

  const own: FetchedChat = fetched.chatId === chatId ? fetched : { chatId };
  const chat = own.chat !== undefined ? own.chat : (seed?.chat ?? null);
  const counterpart = own.counterpart ?? seed?.counterpart ?? EMPTY_COUNTERPART;
  const status: ChatInitStatus = own.chat === null ? 'not_found' : chat ? 'loaded' : 'loading';
  // Unknown (not in the inbox) counts as unread, so the entry read acknowledgement is not skipped.
  const initiallyUnread = seed ? seed.unreadCount > 0 : true;

  return { chat, counterpart, status, initiallyUnread };
}
