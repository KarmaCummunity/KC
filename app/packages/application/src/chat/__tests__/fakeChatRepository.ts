import type { Chat, Message } from '@kc/domain';
import type { IChatRepository, ChatWithPreview } from '../../ports/IChatRepository';

/** Chat ids each viewer has personally hidden (FR-CHAT-016 fake). */
type HiddenMap = Map<string, Set<string>>;

export class FakeChatRepository implements IChatRepository {
  chats: Chat[] = [];
  messages: Message[] = [];
  unread: Record<string, number> = {};
  sendCallCount = 0;
  readonly inboxHidden: HiddenMap = new Map();

  private hiddenFor(chatId: string, viewerId: string): boolean {
    return this.inboxHidden.get(chatId)?.has(viewerId) ?? false;
  }

  /** Simulates JWT user for `hideChatFromInbox` in tests. */
  fakeAuthedUserId = 'a';

  async getMyChats(userId: string): Promise<ChatWithPreview[]> {
    const rows = this.chats
      .filter((c) => c.participantIds.includes(userId) && !this.hiddenFor(c.chatId, userId))
      .map((c) => ({
        ...c,
        otherParticipant: {
          userId: 'other',
          displayName: 'other',
          avatarUrl: null,
          shareHandle: 'other',
          isDeleted: false,
        },
        lastMessage: this.messages.filter((m) => m.chatId === c.chatId).at(-1) ?? null,
        unreadCount: this.unread[c.chatId] ?? 0,
      }));
    const best = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const other = row.participantIds[0] === userId ? row.participantIds[1] : row.participantIds[0];
      const key = other ?? '__deleted__';
      const prev = best.get(key);
      if (!prev) {
        best.set(key, row);
        continue;
      }
      const ts = row.lastMessageAt ? Date.parse(row.lastMessageAt) : 0;
      const pts = prev.lastMessageAt ? Date.parse(prev.lastMessageAt) : 0;
      if (ts > pts || (ts === pts && row.chatId > prev.chatId)) best.set(key, row);
    }
    return [...best.values()].sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return tb - ta;
    });
  }

  async findOrCreateChat(
    userId: string,
    otherUserId: string,
    anchor?: { postId?: string; rideId?: string },
    options?: { preferNewThread?: boolean },
  ): Promise<Chat> {
    const ids = [userId, otherUserId].sort((a, b) => a.localeCompare(b)) as [string, string];
    const anchorPostId = anchor?.postId;
    const anchorRideId = anchor?.rideId;

    if (!options?.preferNewThread) {
      const candidates = this.chats.filter(
        (c) =>
          !c.isSupportThread &&
          c.participantIds[0] === ids[0] &&
          c.participantIds[1] === ids[1] &&
          !this.hiddenFor(c.chatId, userId),
      );
      candidates.sort((x, y) => {
        const tx = x.lastMessageAt ? Date.parse(x.lastMessageAt) : 0;
        const ty = y.lastMessageAt ? Date.parse(y.lastMessageAt) : 0;
        return ty - tx;
      });
      const existing = candidates[0];
      if (existing) {
        const postChanged = anchorPostId !== undefined && existing.anchorPostId !== anchorPostId;
        const rideChanged = anchorRideId !== undefined && existing.anchorRideId !== anchorRideId;
        if (postChanged || rideChanged) {
          const idx = this.chats.indexOf(existing);
          const updated: Chat = {
            ...existing,
            anchorPostId: anchorPostId ?? (rideChanged ? null : existing.anchorPostId),
            anchorRideId: anchorRideId ?? (postChanged ? null : existing.anchorRideId),
            anchorListingId: null,
          };
          this.chats[idx] = updated;
          return updated;
        }
        return existing;
      }
    }

    const chat: Chat = {
      chatId: `chat-${this.chats.length + 1}`,
      participantIds: ids,
      anchorPostId: anchorPostId ?? null,
      anchorRideId: anchorRideId ?? null,
      anchorListingId: null,
      isSupportThread: false,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.chats.push(chat);
    return chat;
  }

  async hideChatFromInbox(chatId: string): Promise<void> {
    const c = this.chats.find((x) => x.chatId === chatId);
    if (!c) return;
    if (c.isSupportThread) throw new Error('support_thread_not_hideable');
    let set = this.inboxHidden.get(chatId);
    if (!set) {
      set = new Set();
      this.inboxHidden.set(chatId, set);
    }
    set.add(this.fakeAuthedUserId);
  }

  async findById(chatId: string): Promise<Chat | null> {
    return this.chats.find((c) => c.chatId === chatId) ?? null;
  }

  async getMessages(chatId: string, limit: number, _beforeCreatedAt?: string): Promise<Message[]> {
    return this.messages.filter((m) => m.chatId === chatId).slice(-limit).reverse();
  }

  async sendMessage(chatId: string, senderId: string, body: string): Promise<Message> {
    this.sendCallCount += 1;
    const msg: Message = {
      messageId: `msg-${this.messages.length + 1}`,
      chatId,
      senderId,
      kind: 'user',
      body,
      systemPayload: null,
      mediaPayload: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
    };
    this.messages.push(msg);
    this.inboxHidden.delete(chatId);
    return msg;
  }

  async markRead(chatId: string, _userId: string): Promise<void> {
    this.unread[chatId] = 0;
  }

  async getUnreadTotal(_userId: string): Promise<number> {
    return Object.values(this.unread).reduce((a, b) => a + b, 0);
  }

  async getCounterpart(chat: Chat, viewerId: string) {
    const other = chat.participantIds[0] === viewerId ? chat.participantIds[1] : chat.participantIds[0];
    return { userId: other, displayName: 'fake', avatarUrl: null, shareHandle: 'fake', isDeleted: false };
  }

  async hasSentAnyMessage(userId: string): Promise<boolean> {
    return this.messages.some((m) => m.senderId === userId && m.kind === 'user');
  }

  async submitSupportIssue(_category: string | null, _description: string): Promise<Chat> {
    return this.getOrCreateSupportThread('test-user');
  }

  async getOrCreateSupportThread(userId: string): Promise<Chat> {
    const admin = 'super-admin';
    const ids = [userId, admin].sort((a, b) => a.localeCompare(b)) as [string, string];
    const existing = this.chats.find(
      (c) =>
        c.isSupportThread &&
        c.participantIds[0] === ids[0] &&
        c.participantIds[1] === ids[1],
    );
    if (existing) return existing;
    const chat: Chat = {
      chatId: `support-${this.chats.length + 1}`,
      participantIds: ids,
      anchorPostId: null,
      anchorRideId: null,
      anchorListingId: null,
      isSupportThread: true,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.chats.push(chat);
    return chat;
  }
}
