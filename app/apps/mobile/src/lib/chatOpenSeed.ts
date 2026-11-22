// FR-CHAT-002 — first-frame data for the conversation screen, taken from the inbox cache.
//
// The inbox page (`chat_inbox_page`) already carries every field the conversation header and
// the anchored-post card need: the chat's kind, anchor and the counterpart's public profile.
// Reading it from the React Query cache lets a chat opened from the inbox (or from any screen
// after the inbox has loaded once) paint its header on the first frame, while the network
// revalidates the chat row and the counterpart in parallel (#2566).
import type { Chat, VerificationLevel } from '@kc/domain';
import type { ChatInboxSnapshot } from './chatInboxQuery';

/** The other side of a chat as the conversation header renders it. */
export interface ChatCounterpart {
  userId: string | null;
  displayName: string | null;
  shareHandle: string | null;
  isDeleted: boolean;
  verificationLevel?: VerificationLevel;
}

/** What the conversation screen can render before any request of its own has returned. */
export interface ChatOpenSeed {
  readonly chat: Chat;
  readonly counterpart: ChatCounterpart;
  /** The inbox unread count of this chat; 0 means the server had nothing unread for the viewer. */
  readonly unreadCount: number;
}

/**
 * A support thread shows no counterpart: the staff who answer are not listed, and the header
 * falls back to the support-thread title. Mirrors `SupabaseChatRepository.getCounterpart`, so the
 * seed and the revalidated value never disagree about who is shown.
 */
const SUPPORT_THREAD_COUNTERPART: ChatCounterpart = {
  userId: null,
  displayName: null,
  shareHandle: null,
  isDeleted: false,
};

/** Builds the seed for `chatId` from the cached inbox, or null when the chat is not in it. */
export function chatOpenSeedFromInbox(
  snapshot: ChatInboxSnapshot | undefined,
  chatId: string,
): ChatOpenSeed | null {
  const row = snapshot?.chats.find((c) => c.chatId === chatId);
  if (!row) return null;
  // Copy only the `Chat` fields: the preview's message and counts are not part of a chat row.
  const chat: Chat = {
    chatId: row.chatId,
    participantIds: row.participantIds,
    anchorPostId: row.anchorPostId,
    isSupportThread: row.isSupportThread,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
  };
  const other = row.otherParticipant;
  const counterpart: ChatCounterpart = row.isSupportThread
    ? SUPPORT_THREAD_COUNTERPART
    : {
        userId: other.userId,
        displayName: other.displayName,
        shareHandle: other.shareHandle,
        isDeleted: other.isDeleted,
        verificationLevel: other.verificationLevel,
      };
  return { chat, counterpart, unreadCount: row.unreadCount };
}
