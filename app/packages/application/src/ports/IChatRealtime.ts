import type { Message } from '@kc/domain';

/** What the member's inbox topic tells: some chat of theirs changed (ids only, no content). */
export interface InboxChange {
  readonly chatId: string | null;
  readonly lastMessageAt: string | null;
}

export interface InboxStreamCallbacks {
  /** A chat of the member changed (new message, read marker, hide): refresh the inbox. */
  onInboxChanged: (change: InboxChange) => void;
  onUnreadTotalChanged: (total: number) => void;
  /** A new message in a listed chat — bump its row's unread before the debounced total read. */
  onInboxMessageInsert?: (message: Message) => void;
}

/** Optional tuning for inbox realtime (FR-CHAT-012 race with mark-read). */
export interface SubscribeInboxOptions {
  /** When this value changes during `rpc_chat_unread_total`, the RPC result is dropped. */
  getSnapshotEpoch?: () => number;
}

/** The part of a chat that changes while it is open: the post it is pinned to. */
export interface ChatChange {
  readonly chatId: string;
  readonly anchorPostId: string | null;
}

export interface ChatStreamCallbacks {
  onMessage: (m: Message) => void;
  /**
   * A member's read marker advanced (FR-CHAT-011): every message sent by someone else, up to
   * `lastReadAt`, is now read by `userId`.
   */
  onReadMarker: (marker: { userId: string; lastReadAt: string }) => void;
  // Fires when the chat's pinned post changes (FR-CHAT-014 AC6). Optional — consumers that
  // only care about messages can omit it.
  onChatChanged?: (change: ChatChange) => void;
  onError: (err: Error) => void;
}

export type Unsubscribe = () => void;

export interface IChatRealtime {
  subscribeToInbox(
    userId: string,
    cb: InboxStreamCallbacks,
    options?: SubscribeInboxOptions,
  ): Unsubscribe;
  subscribeToChat(chatId: string, cb: ChatStreamCallbacks): Unsubscribe;
}
