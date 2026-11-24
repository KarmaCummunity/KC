// Shared chat store types — keeps `chatStore.ts` under architecture LOC cap (TD-118).
import type { Chat, Message } from '@kc/domain';
import type { ChatChange, IChatRepository, IChatRealtime, MessageReactionChange, Unsubscribe } from '@kc/application';
import type { ChatReactions, MessageReactionRow } from './chatStoreReactions';

export interface OptimisticMessage extends Message {
  clientId: string;
  failed?: boolean;
}

export interface ChatState {
  unreadTotal: number;
  /** Bumps when local read clears row unread; stale network snapshots must not overwrite. */
  inboxSnapshotEpoch: number;
  threads: Record<string, OptimisticMessage[]>;
  /** Known message reactions per chat (#2568); a message id absent from a chat is not read yet. */
  reactions: Record<string, ChatReactions>;
  inboxSub: Unsubscribe | null;
  threadSubs: Record<string, Unsubscribe>;

  upsertChatPreview(chat: Chat): void;
  setUnreadTotal(n: number): void;
  markChatLocallyRead(chatId: string): void;
  bumpInboxForIncomingInsert(viewerId: string, message: Message): void;

  setThreadMessages(chatId: string, msgs: Message[]): void;
  appendOptimistic(chatId: string, msg: OptimisticMessage): void;
  reconcileSent(chatId: string, clientId: string, server: Message): void;
  markFailed(chatId: string, clientId: string): void;
  applyIncomingMessage(chatId: string, msg: Message): void;
  /** A member's read marker advanced: every message sent by someone else up to it is read. */
  applyReadMarker(chatId: string, marker: { userId: string; lastReadAt: string }): void;
  /** Stores a `message_reactions` read for `messageIds` (each becomes known, even without rows). */
  setMessageReactions(chatId: string, messageIds: readonly string[], rows: readonly MessageReactionRow[]): void;
  /** One member's reaction change, from the `reaction` broadcast or the viewer's own toggle. */
  applyReactionChange(chatId: string, change: MessageReactionChange): void;

  startInboxSub(userId: string, repo: IChatRepository, realtime: IChatRealtime): Promise<void>;
  startThreadSub(
    chatId: string,
    repo: IChatRepository,
    realtime: IChatRealtime,
    onChatChanged?: (change: ChatChange) => void,
  ): Promise<void>;
  stopThreadSub(chatId: string): void;
  refreshInbox: (userId: string, repo: IChatRepository) => Promise<void>;
  resetOnSignOut(): void;
}
