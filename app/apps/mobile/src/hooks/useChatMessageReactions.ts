import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageReactionType } from '@kc/infrastructure-supabase';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';
import { hapticLightTap } from '../lib/haptics';

export type ReactionSummary = Partial<Record<MessageReactionType, number>>;

export function useChatMessageReactions(chatId: string, messageIds: string[]) {
  const viewerId = useAuthStore((s) => s.session?.userId);
  const messageIdsKey = messageIds.join('|');
  const messageIdsRef = useRef(messageIds);
  messageIdsRef.current = messageIds;
  const [byMessage, setByMessage] = useState<Record<string, ReactionSummary>>({});
  const [mine, setMine] = useState<Record<string, MessageReactionType | null>>({});

  useEffect(() => {
    const currentMessageIds = messageIdsRef.current;
    if (currentMessageIds.length === 0) return;
    let cancelled = false;
    void container.chatV2Repo.listMessageReactions(currentMessageIds).then((rows) => {
      if (cancelled) return;
      const counts: Record<string, ReactionSummary> = {};
      const own: Record<string, MessageReactionType | null> = {};
      for (const id of currentMessageIds) {
        counts[id] = {};
        own[id] = null;
      }
      for (const r of rows) {
        counts[r.messageId] = counts[r.messageId] ?? {};
        counts[r.messageId]![r.reactionType] = (counts[r.messageId]![r.reactionType] ?? 0) + 1;
        if (viewerId && r.userId === viewerId) own[r.messageId] = r.reactionType;
      }
      setByMessage(counts);
      setMine(own);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, messageIdsKey, viewerId]);

  const toggle = useCallback(async (messageId: string, reaction: MessageReactionType) => {
    hapticLightTap();
    const current = mine[messageId];
    const next = current === reaction ? null : reaction;
    await container.chatV2Repo.setMessageReaction(messageId, next);
    setMine((s) => ({ ...s, [messageId]: next }));
  }, [mine]);

  return { byMessage, mine, toggle };
}
