// KC#873 / #2568 — message reactions of the open conversation.
//
// The reactions live in the chat store (see `chatStoreReactions.ts`). This hook reads
// `message_reactions` only for messages whose reactions are not known yet — the page loaded on
// open — while messages created on screen start empty and every later change arrives as a
// `reaction` broadcast. It used to re-read the whole page whenever any message was added.
import { useCallback, useEffect, useMemo } from 'react';
import type { MessageReactionType } from '@kc/domain';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import type { ChatReactions, MessageReactions } from '../store/chatStoreReactions';
import { hapticSuccess } from '../lib/haptics';
import { reportHandledError } from '../lib/observability/reportHandledError';

export type ReactionSummary = Partial<Record<MessageReactionType, number>>;

/** Stable empty value, so a chat with no known reactions does not re-render its bubbles. */
const NO_CHAT_REACTIONS: ChatReactions = {};

/**
 * Summaries are cached per reactions map. The store replaces only the map of the message that
 * changed, so every other bubble keeps the same summary object and its memo skips the render.
 */
const summaryCache = new WeakMap<MessageReactions, ReactionSummary>();

function summarize(reactions: MessageReactions): ReactionSummary {
  const cached = summaryCache.get(reactions);
  if (cached) return cached;
  const summary: ReactionSummary = {};
  for (const type of Object.values(reactions)) summary[type] = (summary[type] ?? 0) + 1;
  summaryCache.set(reactions, summary);
  return summary;
}

export function useChatMessageReactions(chatId: string, messageIds: string[]) {
  const viewerId = useAuthStore((s) => s.session?.userId);
  const known = useChatStore((s) => s.reactions[chatId] ?? NO_CHAT_REACTIONS);

  // A string key: the read reruns only when the set of unknown ids changes, not on every render.
  const unknownKey = useMemo(() => messageIds.filter((id) => !known[id]).join('|'), [messageIds, known]);

  useEffect(() => {
    if (!unknownKey) return;
    const ids = unknownKey.split('|');
    // No cancellation on purpose: results are stored per chat and message id, so a late answer
    // is still correct, and dropping it would only cost a second read.
    container.chatV2Repo
      .listMessageReactions(ids)
      .then((rows) => useChatStore.getState().setMessageReactions(chatId, ids, rows))
      .catch(() => {
        // Reactions are supplemental; keep the chat usable when their read fails.
      });
  }, [chatId, unknownKey]);

  const { byMessage, mine } = useMemo(() => {
    const summaries: Record<string, ReactionSummary> = {};
    const own: Record<string, MessageReactionType | null> = {};
    for (const [messageId, reactions] of Object.entries(known)) {
      summaries[messageId] = summarize(reactions);
      own[messageId] = (viewerId && reactions[viewerId]) || null;
    }
    return { byMessage: summaries, mine: own };
  }, [known, viewerId]);

  /**
   * Picks a reaction, or clears it when it is the current one. Applied at once (optimistic); a
   * failed request restores the previous reaction and is reported. The server's own broadcast
   * of the change is then a no-op.
   */
  const toggle = useCallback(
    async (messageId: string, reaction: MessageReactionType) => {
      if (!viewerId) return;
      const store = useChatStore.getState();
      const previous = store.reactions[chatId]?.[messageId]?.[viewerId] ?? null;
      const next = previous === reaction ? null : reaction;
      store.applyReactionChange(chatId, { messageId, userId: viewerId, reactionType: next });
      try {
        await container.chatV2Repo.setMessageReaction(messageId, next);
        if (next !== null) hapticSuccess();
      } catch (error) {
        useChatStore.getState().applyReactionChange(chatId, { messageId, userId: viewerId, reactionType: previous });
        reportHandledError(error, 'mutation', ['chat', 'reaction']);
      }
    },
    [chatId, viewerId],
  );

  return { byMessage, mine, toggle };
}
