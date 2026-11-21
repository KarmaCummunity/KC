// FR-CHAT-012 — the conversation screen's only sender of the read acknowledgement (`mark_chat_read`).
//
// It fires on entry when the chat may hold unread messages, and again whenever an incoming message
// newer than the last acknowledgement is unread. One owner keeps entry to a single request
// (#2566): the screen used to send one from the open sequence and a second one here as soon as
// the messages loaded.
import { useEffect, useMemo, useState } from 'react';
import { container } from '../lib/container';
import { reportHandledError } from '../lib/observability/reportHandledError';
import { useChatStore, type OptimisticMessage } from '../store/chatStore';

/** Epoch ms of the newest message in the loaded thread; -Infinity when there is none. */
function newestCreatedAtMs(messages: readonly OptimisticMessage[] | undefined): number {
  let newest = -Infinity;
  for (const m of messages ?? []) newest = Math.max(newest, Date.parse(m.createdAt) || -Infinity);
  return newest;
}

/** What this screen has acknowledged in one chat: every message up to `upToMs` is read. */
interface Acknowledged {
  readonly chatId: string;
  readonly upToMs: number;
}

/**
 * Keeps the server read acknowledgement ahead of the local read state and contains RPC rejection.
 *
 * @param initiallyUnread whether the chat may hold unread messages on entry (the inbox count, or
 *   true when the chat is not in the inbox). It covers unread messages the loaded page cannot
 *   show as unread, e.g. a system message another member has already read.
 */
export function useMarkChatRead(
  messages: OptimisticMessage[],
  chatId: string,
  userId: string,
  initiallyUnread: boolean,
) {
  // Keyed by chat id so a new route param starts over. Null until the first success.
  const [acked, setAcked] = useState<Acknowledged | null>(null);
  const ackedUpToMs = acked?.chatId === chatId ? acked.upToMs : null;

  // The entry acknowledgement waits for the first page: sent together with the page request it
  // would race it, and a page computed before the write would still show unread messages and send
  // a second request. The wait costs nothing visible (only the inbox badge depends on it).
  const threadLoaded = useChatStore((s) => s.threads[chatId] !== undefined);
  const entryPending = initiallyUnread && ackedUpToMs === null && threadLoaded;

  // Messages at or before the last acknowledgement are read on the server even while their local
  // status still says otherwise (the read broadcast may not have arrived): only newer ones count.
  // This also makes a request loop impossible: each success moves the watermark past every message
  // it saw, so the next request needs a message that arrived after it.
  const floorMs = ackedUpToMs ?? -Infinity;
  const unreadIncoming = useMemo(
    () => messages.some((m) => m.senderId !== userId && m.status !== 'read' && Date.parse(m.createdAt) > floorMs),
    [messages, userId, floorMs],
  );
  // Boolean + watermark dependencies: the request goes out on each false → true edge, and once
  // more after a success when a message arrived while it was in flight; never once per render.
  const needsRead = entryPending || unreadIncoming;

  useEffect(() => {
    if (!needsRead) return;
    // Everything loaded before the request is at or before the server's new marker
    // (`last_read_at` becomes the chat's `last_message_at`), so it becomes the new watermark.
    const upToMs = newestCreatedAtMs(useChatStore.getState().threads[chatId]);
    void (async () => {
      await container.markChatRead.execute({ chatId, userId });
      useChatStore.getState().markChatLocallyRead(chatId);
      setAcked({ chatId, upToMs });
    })().catch((error: unknown) => {
      // Keep unread state on failure. No automatic retry loop or false read receipt.
      reportHandledError(error, 'manual', ['chat', 'mark-read']);
    });
  }, [needsRead, floorMs, chatId, userId]);
}
