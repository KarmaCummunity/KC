// Behavioural in-memory IChatRepository (G39 contract fake). Unlike the spy
// fakeChatRepository (canned results + call capture), it implements the port's
// behaviour and must pass the same chatRepositoryContract cases as
// SupabaseChatRepository. Bound to one actor: every call runs as `actorId`, the
// way RLS and auth.uid() scope the Supabase adapter to its signed-in user.

import type { Chat, Message } from '@kc/domain';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../contracts/chatRepository.contract';
import type { ChatWithPreview, IChatRepository } from '../../ports/IChatRepository';
import { ChatError } from '../errors';
import type { InMemoryChatRow, InMemoryChatStore } from './inMemoryChatStore';

type Counterpart = ChatWithPreview['otherParticipant'];

const DELETED_COUNTERPART: Counterpart = {
  userId: null,
  displayName: null,
  avatarUrl: null,
  shareHandle: null,
  isDeleted: true,
};

/** Inbox page size of the adapter's `chats` query. */
const INBOX_LIMIT = 50;

export class InMemoryChatRepository implements IChatRepository {
  constructor(
    private readonly store: InMemoryChatStore,
    private readonly actorId: string,
  ) {}

  async getMyChats(): Promise<ChatWithPreview[]> {
    const visible = [...this.store.chats.values()].filter((row) => this.store.isVisibleInInbox(row, this.actorId));
    return this.latestPerCounterpart(visible)
      .slice(0, INBOX_LIMIT)
      .map((row) => this.preview(row.chat));
  }

  async findOrCreateChat(
    userId: string,
    otherUserId: string,
    anchor?: { postId?: string },
    options?: { preferNewThread?: boolean },
  ): Promise<Chat> {
    if (!this.store.users.has(otherUserId)) {
      throw new ChatError('send_to_deleted_user', 'counterpart_not_found');
    }
    const [a, b] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
    const reusable = options?.preferNewThread ? undefined : this.visibleThreadOfPair(a, b);
    if (!reusable) return this.store.insertChat(a, b, anchor);
    if (anchor?.postId) {
      // One context per chat (0464): the latest anchor replaces the previous one.
      reusable.chat = { ...reusable.chat, anchorPostId: anchor.postId };
    }
    return reusable.chat;
  }

  async hideChatFromInbox(chatId: string): Promise<void> {
    const row = this.store.chats.get(chatId);
    if (!row) throw new ChatError('chat_not_found', 'chat_not_found');
    if (row.chat.isSupportThread) throw new ChatError('support_thread_not_hideable', 'support_thread_not_hideable');
    if (!this.store.isParticipant(row, this.actorId)) throw new ChatError('chat_forbidden', 'forbidden');
    const at = this.store.now();
    row.hiddenAt.set(this.actorId, at);
    // PM decision 2026-11-11 (FR-CHAT-016): what the member removed never comes back to them.
    row.historyFrom.set(this.actorId, at);
  }

  async findById(chatId: string): Promise<Chat | null> {
    const row = this.store.chats.get(chatId);
    return row && this.store.isParticipant(row, this.actorId) ? row.chat : null;
  }

  async getMessages(chatId: string, limit: number, beforeCreatedAt?: string): Promise<Message[]> {
    const row = this.store.chats.get(chatId);
    if (!row || !this.store.isParticipant(row, this.actorId)) return [];
    return this.store
      .messagesOf(chatId, this.actorId)
      .filter((m) => beforeCreatedAt === undefined || m.createdAt < beforeCreatedAt)
      .slice(0, limit);
  }

  async sendMessage(chatId: string, senderId: string, body: string): Promise<Message> {
    const row = this.store.chats.get(chatId);
    // messages_insert_user: only a participant inserts, and only as themselves.
    if (!row || senderId !== this.actorId || !this.store.isParticipant(row, this.actorId)) {
      throw new ChatError('chat_forbidden', 'new row violates row-level security policy');
    }
    if (body.length < 1 || body.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new ChatError('message_too_long', 'messages_user_shape');
    }
    const message: Message = {
      messageId: crypto.randomUUID(),
      chatId,
      senderId,
      kind: 'user',
      body,
      systemPayload: null,
      mediaPayload: null,
      status: 'pending',
      createdAt: this.store.now(),
      deliveredAt: null,
      readAt: null,
    };
    this.store.messages.push(message);
    row.chat = { ...row.chat, lastMessageAt: message.createdAt };
    // chats_clear_inbox_hide_on_message: any new message restores the thread for both sides.
    row.hiddenAt.clear();
    return message;
  }

  async markRead(chatId: string): Promise<void> {
    const row = this.store.chats.get(chatId);
    if (!row || !this.store.isParticipant(row, this.actorId)) throw new ChatError('chat_forbidden', 'forbidden');
    for (const message of this.store.messages) {
      if (message.chatId === chatId && message.senderId !== this.actorId && message.status !== 'read') {
        message.status = 'read';
        message.deliveredAt = message.deliveredAt ?? this.store.now();
      }
    }
  }

  async getUnreadTotal(): Promise<number> {
    let total = 0;
    for (const row of this.store.chats.values()) {
      if (this.store.isVisibleInInbox(row, this.actorId)) total += this.store.unreadIn(row.chat.chatId, this.actorId);
    }
    return total;
  }

  async getCounterpart(chat: Chat, viewerId: string): Promise<Counterpart> {
    return this.counterpartOf(chat, viewerId);
  }

  /** The store has no super admin, which is how the adapter fails on a stack without one. */
  async getOrCreateSupportThread(): Promise<Chat> {
    throw new ChatError('super_admin_not_found', 'super_admin_not_found');
  }

  async submitSupportIssue(): Promise<Chat> {
    throw new ChatError('super_admin_not_found', 'super_admin_not_found');
  }

  async hasSentAnyMessage(userId: string): Promise<boolean> {
    return this.store.messages.some((m) => m.senderId === userId && m.kind === 'user');
  }

  /** The pair's member-to-member thread the actor still sees, latest activity first. */
  private visibleThreadOfPair(a: string, b: string): InMemoryChatRow | undefined {
    return [...this.store.chats.values()]
      .filter((row) => !row.chat.isSupportThread)
      .filter((row) => row.chat.participantIds[0] === a && row.chat.participantIds[1] === b)
      .filter((row) => !row.hiddenAt.has(this.actorId))
      .sort((x, y) => (y.chat.lastMessageAt ?? '').localeCompare(x.chat.lastMessageAt ?? ''))[0];
  }

  /** FR-CHAT-016 AC4: one row per counterpart, the latest activity wins; newest first. */
  private latestPerCounterpart(rows: InMemoryChatRow[]): InMemoryChatRow[] {
    const best = new Map<string, InMemoryChatRow>();
    for (const row of rows) {
      const [a, b] = row.chat.participantIds;
      const key = (a === this.actorId ? b : a) ?? `deleted:${row.chat.chatId}`;
      const previous = best.get(key);
      if (!previous || (row.chat.lastMessageAt ?? '') > (previous.chat.lastMessageAt ?? '')) best.set(key, row);
    }
    return [...best.values()].sort((x, y) => (y.chat.lastMessageAt ?? '').localeCompare(x.chat.lastMessageAt ?? ''));
  }

  /** The other participant's profile, or the deleted placeholder when their account is gone. */
  private counterpartOf(chat: Chat, viewerId: string): Counterpart {
    const otherId = chat.participantIds[0] === viewerId ? chat.participantIds[1] : chat.participantIds[0];
    const user = otherId == null ? undefined : this.store.users.get(otherId);
    if (!user) return DELETED_COUNTERPART;
    return {
      userId: user.userId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      shareHandle: user.shareHandle,
      isDeleted: false,
    };
  }

  private preview(chat: Chat): ChatWithPreview {
    return {
      ...chat,
      otherParticipant: this.counterpartOf(chat, this.actorId),
      lastMessage: this.store.messagesOf(chat.chatId, this.actorId)[0] ?? null,
      unreadCount: this.store.unreadIn(chat.chatId, this.actorId),
    };
  }
}
