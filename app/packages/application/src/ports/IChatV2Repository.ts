import type { Message, MessageReactionType } from '@kc/domain';

/** Message reactions and media messages (FR-CHAT-003; reactions: KC#873). */
export interface IChatV2Repository {
  /** Sets, changes or (with null) clears the caller's reaction on a message. */
  setMessageReaction(messageId: string, reactionType: MessageReactionType | null): Promise<void>;
  /** Sends a media message (image, video, voice, location or post share) with an optional caption. */
  sendMediaMessage(chatId: string, mediaPayload: Record<string, unknown>, body?: string | null, messageId?: string): Promise<Message>;
  /** The reactions on the given messages, one entry per member and message. */
  listMessageReactions(messageIds: string[]): Promise<Array<{ messageId: string; userId: string; reactionType: MessageReactionType }>>;
}
