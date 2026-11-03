import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateDmChat } from '../supabaseDmChat';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SUPPORT_ROW = {
  chat_id: 'c_support',
  participant_a: 'u_aaaa',
  participant_b: 'u_zzzz',
  anchor_post_id: null,
  anchor_ride_id: null,
  anchor_listing_id: null,
  is_support_thread: true,
  last_message_at: '2026-05-16T12:00:00.000Z',
  created_at: '2026-05-16T11:00:00.000Z',
  inbox_hidden_at_a: null,
  inbox_hidden_at_b: null,
};

describe('findOrCreateDmChat - support threads and participant_b filtering', () => {
  it('reuses existing support thread when unique constraint violation 23505 occurs on insert', async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: SUPPORT_ROW, error: null }),
              }),
              maybeSingle: async () => ({ data: SUPPORT_ROW, error: null }),
            }),
            maybeSingle: async () =>
              table === 'users' ? { data: { user_id: 'u_zzzz' }, error: null } : { data: null, error: null },
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key violates chats_unique_support_pair' },
            }),
          }),
        }),
      }),
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient<any>;

    const chat = await findOrCreateDmChat(
      client,
      'u_aaaa',
      'u_zzzz',
      undefined,
      { preferNewThread: true },
    );

    expect(chat.chatId).toBe('c_support');
    expect(chat.isSupportThread).toBe(true);
  });

  it('filters by inbox_hidden_at_b when viewer is participant_b', async () => {
    // userId is 'u_zzzz', otherUserId is 'u_aaaa'. So a = 'u_aaaa', b = 'u_zzzz'.
    // Viewer is participant_b.
    const hiddenForB = {
      ...SUPPORT_ROW,
      chat_id: 'c_hidden_for_b',
      is_support_thread: false,
      inbox_hidden_at_a: null,
      inbox_hidden_at_b: '2026-05-16T12:00:00.000Z',
    };
    const freshChat = {
      ...SUPPORT_ROW,
      chat_id: 'c_fresh_for_b',
      is_support_thread: false,
    };

    const client = {
      from: (_table: string) => ({
        select: () => {
          const chain: any = {
            eq: () => chain,
            order: () => ({
              limit: async () => ({ data: [hiddenForB], error: null }),
            }),
            maybeSingle: async () => ({ data: { user_id: 'u_aaaa' }, error: null }),
          };
          return chain;
        },
        insert: () => ({
          select: () => ({
            single: async () => ({ data: freshChat, error: null }),
          }),
        }),
      }),
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient<any>;

    const chat = await findOrCreateDmChat(client, 'u_zzzz', 'u_aaaa');
    expect(chat.chatId).toBe('c_fresh_for_b');
  });

  it('re-anchors to rideId via rpc_chat_set_anchor_ride when existing chat has different ride anchor', async () => {
    const existing = {
      ...SUPPORT_ROW,
      chat_id: 'c_existing_ride',
      is_support_thread: false,
      anchor_ride_id: 'r_old',
    };
    const rpcCalls: any[] = [];

    const client = {
      from: (_table: string) => ({
        select: () => {
          const chain: any = {
            eq: () => chain,
            order: () => ({
              limit: async () => ({ data: [existing], error: null }),
            }),
            maybeSingle: async () => ({ data: { user_id: 'u_zzzz' }, error: null }),
          };
          return chain;
        },
      }),
      rpc: async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        return { data: [{ ...existing, anchor_ride_id: 'r_new' }], error: null };
      },
    } as unknown as SupabaseClient<any>;

    const chat = await findOrCreateDmChat(client, 'u_aaaa', 'u_zzzz', { rideId: 'r_new' });

    expect(rpcCalls).toEqual([
      {
        fn: 'rpc_chat_set_anchor_ride',
        args: { p_chat_id: 'c_existing_ride', p_anchor_ride_id: 'r_new' },
      },
    ]);
    expect(chat.anchorRideId).toBe('r_new');
  });
});
