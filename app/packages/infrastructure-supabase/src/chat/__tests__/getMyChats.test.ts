import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMyChats } from '../getMyChats';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  chats?: any[];
  chatsError?: { message: string } | null;
  messages?: any[];
  messagesError?: { message: string } | null;
  /** Per-chat unread counts: `[{ chat_id, unread_count }, ...]`. */
  unread?: Array<{ chat_id: string; unread_count: number }>;
  unreadError?: { message: string } | null;
  users?: any[];
  usersError?: { message: string } | null;
}

function makeFakeClient(opts: FakeOpts): { client: SupabaseClient<any> } {
  const client = {
    from: (table: string) => {
      if (table === 'chats') {
        const chatsPromise = () =>
          Promise.resolve({ data: opts.chats ?? [], error: opts.chatsError ?? null });
        return { select: () => ({ or: () => ({ order: () => ({ limit: () => chatsPromise() }) }) }) };
      }
      if (table === 'messages') {
        // Single call now (last-message preview only). PERF-5: unread counts
        // moved to rpc_unread_counts_for_chats.
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: opts.messages ?? [], error: opts.messagesError ?? null }),
              }),
            }),
          }),
        };
      }
      if (table === 'users') {
        return { select: () => ({ in: async () => ({ data: opts.users ?? [], error: opts.usersError ?? null }) }) };
      }
      throw new Error(`fake: unexpected table ${table}`);
    },
    rpc: async (fnName: string) => {
      if (fnName === 'rpc_unread_counts_for_chats') {
        return { data: opts.unread ?? [], error: opts.unreadError ?? null };
      }
      throw new Error(`fake: unexpected rpc ${fnName}`);
    },
  } as unknown as SupabaseClient<any>;
  return { client };
}

const CHAT_ROW = {
  chat_id: 'c_1',
  participant_a: 'u_me',
  participant_b: 'u_other',
  anchor_post_id: null,
  is_support_thread: false,
  last_message_at: '2026-05-16T12:00:00.000Z',
  created_at: '2026-05-16T11:00:00.000Z',
  inbox_hidden_at_a: null,
  inbox_hidden_at_b: null,
};
const MSG_ROW = (over: Partial<any> = {}) => ({
  message_id: 'm_1',
  chat_id: 'c_1',
  sender_id: 'u_other',
  kind: 'user',
  body: 'hi',
  system_payload: null,
  status: 'delivered',
  created_at: '2026-05-16T12:00:00.000Z',
  delivered_at: '2026-05-16T12:00:01.000Z',
  read_at: null,
  ...over,
});

describe('getMyChats — empty + error paths', () => {
  it('returns [] when no chats match the viewer', async () => {
    const { client } = makeFakeClient({ chats: [] });
    expect(await getMyChats(client, 'u_me')).toEqual([]);
  });

  it('throws via mapChatError on chats query error', async () => {
    const { client } = makeFakeClient({ chatsError: { message: 'transport' } });
    await expect(getMyChats(client, 'u_me')).rejects.toMatchObject({ name: 'ChatError' });
  });

  it('throws via mapChatError on messages query error', async () => {
    const { client } = makeFakeClient({
      chats: [CHAT_ROW],
      messagesError: { message: 'transport' },
    });
    await expect(getMyChats(client, 'u_me')).rejects.toMatchObject({ name: 'ChatError' });
  });

  it('throws via mapChatError on users query error', async () => {
    const { client } = makeFakeClient({
      chats: [CHAT_ROW],
      messages: [MSG_ROW()],
      usersError: { message: 'transport' },
    });
    await expect(getMyChats(client, 'u_me')).rejects.toMatchObject({ name: 'ChatError' });
  });
});

describe('getMyChats — happy paths', () => {
  it('returns a ChatWithPreview with the resolved otherParticipant + lastMessage', async () => {
    const { client } = makeFakeClient({
      chats: [CHAT_ROW],
      messages: [MSG_ROW()],
      users: [{ user_id: 'u_other', display_name: 'Alice', avatar_url: 'a.jpg', share_handle: 'alice', verification_level: 1 }],
    });
    const out = await getMyChats(client, 'u_me');
    expect(out).toHaveLength(1);
    expect(out[0]?.otherParticipant).toEqual({
      userId: 'u_other',
      displayName: 'Alice',
      avatarUrl: 'a.jpg',
      shareHandle: 'alice',
      isDeleted: false,
      verificationLevel: 1,
    });
    expect(out[0]?.lastMessage?.messageId).toBe('m_1');
  });

  it('marks otherParticipant deleted when the counterpart user row is missing — displayName null (UI renders placeholder, PR #246)', async () => {
    const { client } = makeFakeClient({ chats: [CHAT_ROW], messages: [MSG_ROW()], users: [] });
    expect((await getMyChats(client, 'u_me'))[0]?.otherParticipant).toEqual({
      userId: null,
      displayName: null,
      avatarUrl: null,
      shareHandle: null,
      isDeleted: true,
    });
  });

  it('keeps only the most recent message per chat (lastMessage)', async () => {
    // Messages arrive sorted newest-first by .order; helper writes only the
    // first per chatId.
    const { client } = makeFakeClient({
      chats: [CHAT_ROW],
      messages: [
        MSG_ROW({ message_id: 'm_new', created_at: '2026-05-16T12:30:00.000Z' }),
        MSG_ROW({ message_id: 'm_old', created_at: '2026-05-16T12:00:00.000Z' }),
      ],
      users: [{ user_id: 'u_other', display_name: 'A', avatar_url: null, share_handle: 'a' }],
    });
    expect((await getMyChats(client, 'u_me'))[0]?.lastMessage?.messageId).toBe('m_new');
  });

  it('unreadCount reads the server-computed per-chat count from rpc_unread_counts_for_chats (PERF-5)', async () => {
    // PERF-5 moved the status<>'read' AND sender<>viewer logic into the RPC.
    // The FE now just maps `unread_count` onto the matching chat row.
    const { client } = makeFakeClient({
      chats: [CHAT_ROW],
      messages: [MSG_ROW()],
      unread: [{ chat_id: 'c_1', unread_count: 2 }],
      users: [{ user_id: 'u_other', display_name: 'A', avatar_url: null, share_handle: 'a' }],
    });
    expect((await getMyChats(client, 'u_me'))[0]?.unreadCount).toBe(2);
  });

  it('unreadCount is 0 when the RPC returns no row for the chat (no unread messages)', async () => {
    const { client } = makeFakeClient({
      chats: [CHAT_ROW],
      messages: [MSG_ROW()],
      unread: [],
      users: [{ user_id: 'u_other', display_name: 'A', avatar_url: null, share_handle: 'a' }],
    });
    expect((await getMyChats(client, 'u_me'))[0]?.unreadCount).toBe(0);
  });

  it('hides chats with inbox_hidden_at set on the viewer side (FR-CHAT-016)', async () => {
    // Two chats; the older one is hidden for the viewer side → only the
    // visible one survives.
    const { client } = makeFakeClient({
      chats: [
        { ...CHAT_ROW, chat_id: 'c_visible' },
        {
          ...CHAT_ROW,
          chat_id: 'c_hidden',
          participant_b: 'u_other2',
          inbox_hidden_at_a: '2026-05-15T00:00:00.000Z',
          last_message_at: '2026-05-15T00:00:00.000Z',
        },
      ],
      messages: [],
      users: [{ user_id: 'u_other', display_name: 'A', avatar_url: null, share_handle: 'a' }],
    });
    const out = await getMyChats(client, 'u_me');
    expect(out.map((c) => c.chatId)).toEqual(['c_visible']);
  });

  it('final sort places chats with null lastMessageAt at the bottom', async () => {
    const { client } = makeFakeClient({
      chats: [
        { ...CHAT_ROW, chat_id: 'c_null', last_message_at: null, participant_b: 'u_a' },
        { ...CHAT_ROW, chat_id: 'c_dated', last_message_at: '2026-05-16T12:00:00.000Z', participant_b: 'u_b' },
      ],
      messages: [],
      users: [
        { user_id: 'u_a', display_name: 'A', avatar_url: null, share_handle: 'a' },
        { user_id: 'u_b', display_name: 'B', avatar_url: null, share_handle: 'b' },
      ],
    });
    const out = await getMyChats(client, 'u_me');
    expect(out.map((c) => c.chatId)).toEqual(['c_dated', 'c_null']);
  });
});
