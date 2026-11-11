// Supabase adapter for IChatRepository over the baseline messaging module
// (supabase/schemas/40_messaging): page RPCs for the inbox and the messages, one RPC per action.
// Mapped to spec: FR-CHAT-001..013, FR-CHAT-016.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatError, type IChatRepository, type ChatWithPreview } from '@kc/application';
import { toVerificationLevel, type Chat, type Message, type VerificationLevel } from '@kc/domain';
import type { Database } from '../database.types';
import { rowToChat, rowToMessage, readAtFor, CHAT_COLUMNS, type MessageRowSlice, type ReadMarker } from './rowMappers';
import { chatCall, requireRow } from './mapChatError';
import { getMyChats } from './getMyChats';
import { openDirectChat, openSupportThread, hideChat } from './supabaseDmChat';
import { submitSupportIssue } from './submitSupportIssue';

type Counterpart = Awaited<ReturnType<IChatRepository['getCounterpart']>>;

/** What the screens show for a counterpart that is gone, or that a chat never has. */
const NO_COUNTERPART: Counterpart = {
  userId: null,
  displayName: null,
  avatarUrl: null,
  shareHandle: null,
  isDeleted: true,
};

export class SupabaseChatRepository implements IChatRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findById(chatId: string): Promise<Chat | null> {
    const row = await chatCall(
      'table:chats',
      this.client.from('chats').select(CHAT_COLUMNS).eq('id', chatId).maybeSingle(),
    );
    return row ? rowToChat(row) : null;
  }

  /**
   * The baseline keeps exactly one direct chat per pair and un-hides it on open, so the
   * `preferNewThread` option (a second chat after a personal hide) has nothing left to do and is
   * ignored. A ride anchor is a post anchor.
   */
  async findOrCreateChat(
    _userId: string,
    otherUserId: string,
    anchor?: { postId?: string },
    _options?: { preferNewThread?: boolean },
  ): Promise<Chat> {
    return openDirectChat(this.client, otherUserId, anchor);
  }

  async hideChatFromInbox(chatId: string): Promise<void> {
    return hideChat(this.client, chatId);
  }

  /** Newest first. Read receipts come from the members' read markers, loaded with the page. */
  async getMessages(chatId: string, limit: number, beforeCreatedAt?: string): Promise<Message[]> {
    try {
      const [rows, markers] = await Promise.all([
        chatCall(
          'rpc:chat_messages_page',
          this.client.rpc('chat_messages_page', { p_chat_id: chatId, p_limit: limit, p_before: beforeCreatedAt }),
        ),
        this.readMarkers(chatId),
      ]);
      return (rows ?? []).map((row: MessageRowSlice) => rowToMessage(row, readAtFor(row, markers)));
    } catch (error) {
      // A chat the caller is not a member of reads as empty (FR-CHAT-003), as it did under row-level
      // security; the RPC names it `chat_not_found` so as not to confirm that the chat exists.
      if (error instanceof ChatError && error.code === 'chat_not_found') return [];
      throw error;
    }
  }

  /** Sends a text message; `messageId` makes a retry idempotent (the server returns the first copy). */
  async sendMessage(chatId: string, _senderId: string, body: string, messageId?: string): Promise<Message> {
    try {
      const row = await chatCall(
        'rpc:send_message',
        this.client.rpc('send_message', { p_chat_id: chatId, p_body: body, p_message_id: messageId }),
      );
      return rowToMessage(requireRow(row, 'send_message'));
    } catch (error) {
      // The server answers `chat_not_found` for a chat the caller is not in, so as not to confirm it
      // exists; for a send that is the participants-only refusal of FR-CHAT-003.
      if (error instanceof ChatError && error.code === 'chat_not_found') {
        throw new ChatError('chat_forbidden', 'chat_forbidden', error);
      }
      throw error;
    }
  }

  async markRead(chatId: string, _userId: string): Promise<void> {
    await chatCall('rpc:mark_chat_read', this.client.rpc('mark_chat_read', { p_chat_id: chatId }));
  }

  async getUnreadTotal(_userId: string): Promise<number> {
    return Number(await chatCall('rpc:chat_unread_total', this.client.rpc('chat_unread_total')));
  }

  async submitSupportIssue(category: string | null, description: string): Promise<Chat> {
    return submitSupportIssue(this.client, category, description);
  }

  async getOrCreateSupportThread(_userId: string): Promise<Chat> {
    return openSupportThread(this.client);
  }

  /** True when the caller has sent at least one ordinary (non-system, non-media) message. */
  async hasSentAnyMessage(userId: string): Promise<boolean> {
    const rows = await chatCall(
      'table:messages',
      this.client.from('messages').select('id').eq('sender_id', userId).eq('kind', 'user').limit(1),
    );
    return (rows ?? []).length > 0;
  }

  async getMyChats(userId: string): Promise<ChatWithPreview[]> {
    return getMyChats(this.client, userId);
  }

  /**
   * The other side of a chat as the viewer sees it. A support thread has no counterpart (the
   * staff who answer are not listed); a direct chat whose other member is gone, inactive or
   * hidden by a block yields the deleted-user placeholder.
   */
  async getCounterpart(chat: Chat, viewerId: string): Promise<Counterpart> {
    if (chat.isSupportThread) return { ...NO_COUNTERPART, isDeleted: false };
    const otherId = chat.participantIds[0] === viewerId ? chat.participantIds[1] : chat.participantIds[0];
    if (otherId == null) return NO_COUNTERPART;
    const row = await chatCall(
      'table:users',
      this.client
        .from('users')
        .select('id, display_name, avatar_url, share_handle, verification_level')
        .eq('id', otherId)
        .maybeSingle(),
    );
    if (!row) return NO_COUNTERPART;
    const verificationLevel: VerificationLevel = toVerificationLevel(row.verification_level);
    return {
      userId: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      shareHandle: row.share_handle,
      isDeleted: false,
      verificationLevel,
    };
  }

  /** Every member's read marker in a chat (readable by the members under RLS). */
  private async readMarkers(chatId: string): Promise<ReadMarker[]> {
    const rows = await chatCall(
      'table:chat_members',
      this.client.from('chat_members').select('user_id, last_read_at').eq('chat_id', chatId),
    );
    return (rows ?? []).map((row) => ({ userId: row.user_id, lastReadAt: row.last_read_at }));
  }
}
