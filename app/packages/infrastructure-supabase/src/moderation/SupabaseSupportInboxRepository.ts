import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ISupportInboxRepository, SupportThreadCursor, SupportThreadPage, SupportThreadSummary,
} from '@kc/application';
import { ChatError } from '@kc/application';
import type { Database } from '../database.types';
import { mapChatError, requireRow } from '../chat/mapChatError';
import { refusalReason } from '../admin/refusalReason';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

/** One staff call; a caller without the staff role (`forbidden`) reads as `chat_forbidden`. */
async function staffCall<T>(object: string, pending: PromiseLike<CallResult<T>>): Promise<T> {
  try {
    return unwrapCall(object, await pending);
  } catch (error) {
    if (refusalReason(error) === 'forbidden') throw new ChatError('chat_forbidden', 'forbidden', error);
    throw mapChatError(error);
  }
}

/** A function that returns one `chats` row may surface it bare or as a one-element array. */
function chatIdOf(data: unknown, rpcName: string): string {
  const row = (Array.isArray(data) ? data[0] : data) as { id?: string } | null | undefined;
  return requireRow(row?.id ? row : null, rpcName).id as string;
}

/**
 * FR-CHAT-007 / FR-MOD-002 / FR-ADMIN-013 AC2 — the staff support inbox over the RPCs of
 * migration 0015. Refusals map like any messaging call (`chat_not_found`,
 * `user_unavailable` → `send_to_deleted_user`); a caller who is not staff gets `chat_forbidden`.
 */
export class SupabaseSupportInboxRepository implements ISupportInboxRepository {
  constructor(private readonly client: Client) {}

  async listThreads(cursor: SupportThreadCursor | null, limit: number): Promise<SupportThreadPage> {
    const rows = await staffCall(
      'rpc:admin_list_support_threads',
      this.client.rpc('admin_list_support_threads', {
        p_before_last_message_at: cursor?.lastMessageAt,
        p_before_id: cursor?.chatId,
        p_limit: limit,
      }),
    ) ?? [];
    const threads: SupportThreadSummary[] = rows.map((row) => ({
      chatId: row.chat_id,
      memberId: row.member_id ?? null,
      memberDisplayName: row.member_display_name ?? null,
      memberAvatarUrl: row.member_avatar_url ?? null,
      lastMessageAt: row.last_message_at,
      joined: row.joined,
    }));
    const last = threads[threads.length - 1];
    return {
      threads,
      nextCursor: threads.length === limit && last ? { lastMessageAt: last.lastMessageAt, chatId: last.chatId } : null,
    };
  }

  async joinThread(chatId: string): Promise<string> {
    const data = await staffCall(
      'rpc:admin_join_support_thread',
      this.client.rpc('admin_join_support_thread', { p_chat_id: chatId }),
    );
    return chatIdOf(data, 'admin_join_support_thread');
  }

  async openMemberThread(userId: string): Promise<string> {
    const data = await staffCall(
      'rpc:admin_open_member_support_thread',
      this.client.rpc('admin_open_member_support_thread', { p_user_id: userId }),
    );
    return chatIdOf(data, 'admin_open_member_support_thread');
  }
}
