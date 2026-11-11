// Message reactions and media messages over the baseline RPCs.
// Mapped to spec: FR-CHAT-003 (sending, incl. media messages); reactions: KC#873.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '@kc/domain';
import type { Database, Json } from '../database.types';
import { rowToMessage } from './rowMappers';
import { chatCall, requireRow } from './mapChatError';

export type MessageReactionType = 'like' | 'love' | 'laugh' | 'sad';

export class SupabaseChatV2Repository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Sets, changes or (with null) clears the caller's reaction; the change arrives as a `reaction` broadcast. */
  async setMessageReaction(messageId: string, reactionType: MessageReactionType | null): Promise<void> {
    await chatCall(
      'rpc:set_message_reaction',
      // The server treats a null reaction as "clear"; the generated argument type is not nullable.
      this.client.rpc('set_message_reaction', {
        p_message_id: messageId,
        p_reaction_type: reactionType as string,
      }),
    );
  }

  /** Sends a media message (image, video, voice, location or post share) with an optional caption. */
  async sendMediaMessage(
    chatId: string,
    mediaPayload: Record<string, unknown>,
    body?: string | null,
    messageId?: string,
  ): Promise<Message> {
    const row = await chatCall(
      'rpc:send_message',
      this.client.rpc('send_message', {
        p_chat_id: chatId,
        p_body: body ?? '',
        p_media_payload: mediaPayload as Json,
        p_message_id: messageId,
      }),
    );
    return rowToMessage(requireRow(row, 'send_message'));
  }

  async listMessageReactions(messageIds: string[]): Promise<
    Array<{ messageId: string; userId: string; reactionType: MessageReactionType }>
  > {
    if (messageIds.length === 0) return [];
    const rows = await chatCall(
      'table:message_reactions',
      this.client.from('message_reactions').select('message_id, user_id, reaction_type').in('message_id', messageIds),
    );
    return (rows ?? []).map((r) => ({
      messageId: r.message_id,
      userId: r.user_id,
      reactionType: r.reaction_type as MessageReactionType,
    }));
  }
}
