// Shared state behind InMemoryChatRepository instances (G39 contract fake).
// One store plays the database; one repository per actor plays an RLS-scoped
// client, exactly like one SupabaseChatRepository per signed-in user.

import type { Chat, Message } from '@kc/domain';

export interface InMemoryChatUser {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly shareHandle: string;
}

/** One `chats` row: the domain chat plus the per-side inbox-hide stamps (FR-CHAT-016). */
export interface InMemoryChatRow {
  chat: Chat;
  /** `inbox_hidden_at_a` / `_b`, keyed by participant id; absent = visible. */
  readonly hiddenAt: Map<string, string>;
}

export class InMemoryChatStore {
  readonly users = new Map<string, InMemoryChatUser>();
  readonly chats = new Map<string, InMemoryChatRow>();
  readonly messages: Message[] = [];
  private lastTickMs = 0;

  addUser(overrides: Partial<InMemoryChatUser> = {}): InMemoryChatUser {
    const userId = overrides.userId ?? crypto.randomUUID();
    const user: InMemoryChatUser = {
      userId,
      displayName: overrides.displayName ?? `user ${userId.slice(0, 6)}`,
      avatarUrl: overrides.avatarUrl ?? null,
      shareHandle: overrides.shareHandle ?? `u_${userId.slice(0, 8)}`,
    };
    this.users.set(userId, user);
    return user;
  }

  /** Strictly increasing timestamps, so `created_at` ordering is total as with Postgres' clock. */
  now(): string {
    this.lastTickMs = Math.max(Date.now(), this.lastTickMs + 1);
    return new Date(this.lastTickMs).toISOString();
  }

  /** Inserts a `chats` row for the ordered pair; `last_message_at` defaults to the creation time. */
  insertChat(participantA: string, participantB: string, anchor?: { postId?: string }): Chat {
    const createdAt = this.now();
    const chat: Chat = {
      chatId: crypto.randomUUID(),
      participantIds: [participantA, participantB],
      anchorPostId: anchor?.postId ?? null,
      isSupportThread: false,
      lastMessageAt: createdAt,
      createdAt,
    };
    this.chats.set(chat.chatId, { chat, hiddenAt: new Map() });
    return chat;
  }

  isParticipant(row: InMemoryChatRow, userId: string): boolean {
    return row.chat.participantIds.includes(userId);
  }

  /** Not inbox-hidden for the viewer (FR-CHAT-016); non-participants never see the row. */
  isVisibleInInbox(row: InMemoryChatRow, userId: string): boolean {
    return this.isParticipant(row, userId) && !row.hiddenAt.has(userId);
  }

  /** Messages of one chat, newest first. */
  messagesOf(chatId: string): Message[] {
    return this.messages
      .filter((m) => m.chatId === chatId)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  /** A participant's unread messages in one chat: the counterpart's, not yet read (FR-CHAT-012). */
  unreadIn(chatId: string, viewerId: string): number {
    return this.messages.filter((m) => m.chatId === chatId && m.senderId !== viewerId && m.status !== 'read').length;
  }
}
