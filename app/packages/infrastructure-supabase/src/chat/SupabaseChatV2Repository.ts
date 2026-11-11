// KC#873 — reactions + media message RPCs.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { rowToMessage } from './rowMappers';
import { mapChatError } from './mapChatError';

export type MessageReactionType = 'like' | 'love' | 'laugh' | 'sad';

export class SupabaseChatV2Repository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async setMessageReaction(messageId: string, reactionType: MessageReactionType | null): Promise<void> {
    const { error } = await this.client.rpc(
      'rpc_set_message_reaction' as never,
      { p_message_id: messageId, p_reaction_type: reactionType } as never,
    );
    if (error) throw mapChatError(error);
  }

  async sendMediaMessage(
    chatId: string,
    mediaPayload: Record<string, unknown>,
    body?: string | null,
  ): Promise<Message> {
    const { data, error } = await this.client.rpc(
      'rpc_send_chat_media_message' as never,
      {
        p_chat_id: chatId,
        p_media_payload: mediaPayload,
        p_body: body ?? null,
      } as never,
    );
    if (error) throw mapChatError(error);
    return rowToMessage(data as Parameters<typeof rowToMessage>[0]);
  }

  async listMessageReactions(messageIds: string[]): Promise<
    Array<{ messageId: string; userId: string; reactionType: MessageReactionType }>
  > {
    if (messageIds.length === 0) return [];
    const { data, error } = await this.client
      .from('message_reactions' as never)
      .select('message_id, user_id, reaction_type')
      .in('message_id', messageIds);
    if (error) throw mapChatError(error);
    return ((data ?? []) as Array<{ message_id: string; user_id: string; reaction_type: string }>).map((r) => ({
      messageId: r.message_id,
      userId: r.user_id,
      reactionType: r.reaction_type as MessageReactionType,
    }));
  }
}
