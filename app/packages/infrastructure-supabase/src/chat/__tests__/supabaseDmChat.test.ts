import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatError } from '@kc/application';
import { findOrCreateDmChat, hideDmChatFromInbox } from '../supabaseDmChat';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  userExists?: boolean;
  chatsList?: any[];
  chatsListError?: { message: string } | null;
  chatsInsertData?: any;
  chatsInsertError?: { code?: string; message?: string; details?: string } | null;
  setAnchorData?: any;
  setAnchorError?: { message: string } | null;
  hideError?: { message: string } | null;
}
interface Calls {
  rpcs: { fn: string; args: unknown }[];
  inserts: { table: string; row: unknown }[];
}

function makeFakeClient(opts: FakeOpts = {}): { client: SupabaseClient<any>; calls: Calls } {
  const calls: Calls = { rpcs: [], inserts: [] };
  // Proxy chain: every method either returns the same proxy (chainable)
  // or a terminator Promise routed by table.
  function makeChain(table: string): any {
    return new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return undefined;
        return () => {
          if (prop === 'maybeSingle') {
            return table === 'users'
              ? Promise.resolve({ data: opts.userExists ? { user_id: 'u_other' } : null, error: null })
              : Promise.resolve({ data: null, error: null });
          }
          if (prop === 'order') {
            // Return a chainable object so .limit() can be called after .order()
            return {
              limit: () => Promise.resolve({ data: opts.chatsList ?? [], error: opts.chatsListError ?? null }),
            };
          }
          return makeChain(table);
        };
      },
    });
  }
  const client = {
    from: (table: string) => ({
      select: () => makeChain(table),
      insert: (row: unknown) => ({
        select: () => ({
          single: async () => {
            calls.inserts.push({ table, row });
            return { data: opts.chatsInsertData ?? null, error: opts.chatsInsertError ?? null };
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      calls.rpcs.push({ fn, args });
      if (fn === 'rpc_chat_set_anchor' || fn === 'rpc_chat_set_anchor_ride') {
        return { data: opts.setAnchorData ?? null, error: opts.setAnchorError ?? null };
      }
      if (fn === 'rpc_chat_hide_for_viewer') return { data: null, error: opts.hideError ?? null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

const CHAT_ROW = {
  chat_id: 'c_1',
  participant_a: 'u_a',
  participant_b: 'u_b',
  anchor_post_id: null,
  anchor_ride_id: null,
  is_support_thread: false,
  last_message_at: '2026-05-16T12:00:00.000Z',
  created_at: '2026-05-16T11:00:00.000Z',
  inbox_hidden_at_a: null,
  inbox_hidden_at_b: null,
};

describe('hideDmChatFromInbox', () => {
  it('invokes rpc_chat_hide_for_viewer with the chatId', async () => {
    const { client, calls } = makeFakeClient({});
    await hideDmChatFromInbox(client, 'c_1');
    expect(calls.rpcs).toEqual([{ fn: 'rpc_chat_hide_for_viewer', args: { p_chat_id: 'c_1' } }]);
  });

  it('maps RPC errors through mapChatError', async () => {
    const { client } = makeFakeClient({
      hideError: { message: 'transport error' },
    });
    await expect(hideDmChatFromInbox(client, 'c_1')).rejects.toMatchObject({ name: 'ChatError' });
  });
});

describe('findOrCreateDmChat', () => {
  it('throws ChatError("send_to_deleted_user") when the counterpart user does not exist', async () => {
    const { client } = makeFakeClient({ userExists: false });

    let caught: unknown;
    try {
      await findOrCreateDmChat(client, 'u_me', 'u_other');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ChatError);
    expect((caught as ChatError).code).toBe('send_to_deleted_user');
  });

  it('returns an existing visible chat when one is found in default mode', async () => {
    // The viewer is participant_a (userId < otherUserId), so visible means
    // inbox_hidden_at_a == null.
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsList: [{ ...CHAT_ROW, chat_id: 'c_existing' }],
    });

    const chat = await findOrCreateDmChat(client, 'u_aaaa', 'u_zzzz');

    expect(chat.chatId).toBe('c_existing');
    expect(calls.inserts).toHaveLength(0); // no new row created
  });

  it('skips a chat row whose viewer-side inbox_hidden_at is set, falling through to insert', async () => {
    // Single existing row, but hidden for viewer (participant_a) → must
    // create a new chat instead of reusing the hidden one.
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsList: [{ ...CHAT_ROW, inbox_hidden_at_a: '2026-05-15T00:00:00.000Z' }],
      chatsInsertData: { ...CHAT_ROW, chat_id: 'c_fresh' },
    });

    const chat = await findOrCreateDmChat(client, 'u_aaaa', 'u_zzzz');

    expect(chat.chatId).toBe('c_fresh');
    expect(calls.inserts).toHaveLength(1);
  });

  it('inserts directly when preferNewThread is true (no existing-chat lookup)', async () => {
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsInsertData: { ...CHAT_ROW, chat_id: 'c_new' },
    });

    const chat = await findOrCreateDmChat(
      client,
      'u_aaaa',
      'u_zzzz',
      { postId: 'p_anchor' },
      { preferNewThread: true },
    );

    expect(chat.chatId).toBe('c_new');
    expect(calls.inserts).toEqual([
      {
        table: 'chats',
        row: {
          participant_a: 'u_aaaa',
          participant_b: 'u_zzzz',
          anchor_post_id: 'p_anchor',
          anchor_ride_id: null,
        },
      },
    ]);
  });

  it('derives ordered participant pair (lexicographically smaller userId → participant_a)', async () => {
    // When userId > otherUserId, the insert payload must swap to keep the
    // canonical ordering required by chats_unique_support_pair.
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsInsertData: { ...CHAT_ROW, chat_id: 'c_new' },
    });

    await findOrCreateDmChat(client, 'u_zzzz', 'u_aaaa', undefined, {
      preferNewThread: true,
    });

    expect((calls.inserts[0]?.row as { participant_a: string }).participant_a).toBe('u_aaaa');
    expect((calls.inserts[0]?.row as { participant_b: string }).participant_b).toBe('u_zzzz');
  });

  it('re-anchors an existing chat via rpc_chat_set_anchor when anchorPostId differs', async () => {
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsList: [{ ...CHAT_ROW, chat_id: 'c_existing', anchor_post_id: 'p_old' }],
      setAnchorData: [{ ...CHAT_ROW, chat_id: 'c_existing', anchor_post_id: 'p_new' }],
    });

    const chat = await findOrCreateDmChat(client, 'u_aaaa', 'u_zzzz', { postId: 'p_new' });

    expect(chat.anchorPostId).toBe('p_new');
    expect(calls.rpcs).toEqual([
      { fn: 'rpc_chat_set_anchor', args: { p_chat_id: 'c_existing', p_anchor_post_id: 'p_new' } },
    ]);
  });

  it('does NOT call set_anchor when the existing chat already has the requested anchor', async () => {
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsList: [{ ...CHAT_ROW, anchor_post_id: 'p_same' }],
    });

    await findOrCreateDmChat(client, 'u_aaaa', 'u_zzzz', { postId: 'p_same' });

    expect(calls.rpcs).toHaveLength(0);
  });

  // KC#1297 — a chat shows one context: a listing anchor gives way to the post or ride entry.
  it.each([
    [{ postId: 'p_same' }, 'rpc_chat_set_anchor', { anchor_post_id: 'p_same' }],
    [{ rideId: 'r_same' }, 'rpc_chat_set_anchor_ride', { anchor_ride_id: 'r_same' }],
  ] as const)('re-anchors a listing-anchored chat entered from %o', async (anchor, rpc, current) => {
    const { client, calls } = makeFakeClient({
      userExists: true,
      chatsList: [{ ...CHAT_ROW, ...current, anchor_listing_id: 'l_1' }],
      setAnchorData: [{ ...CHAT_ROW, ...current, anchor_listing_id: null }],
    });

    const chat = await findOrCreateDmChat(client, 'u_aaaa', 'u_zzzz', anchor);

    expect(calls.rpcs.map((c) => c.fn)).toEqual([rpc]);
    expect(chat.anchorListingId).toBeNull();
  });
});
