import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatError } from '@kc/application';
import type { Chat } from '@kc/domain';
import { SupabaseChatRepository } from '../SupabaseChatRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Companion to SupabaseChatRepository.test.ts — covers the two
// support-thread RPCs (with their array-or-single data-shape quirks)
// and the getCounterpart user lookup with its deleted-account branches.

interface FakeOpts {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  userData?: any;
  userError?: { message: string } | null;
}
interface Calls { rpcs: { fn: string; args: unknown }[] }

function makeFakeClient(opts: FakeOpts = {}): { client: SupabaseClient<any>; calls: Calls } {
  const calls: Calls = { rpcs: [] };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.userData ?? null, error: opts.userError ?? null }),
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      calls.rpcs.push({ fn, args });
      return { data: opts.rpcData ?? null, error: opts.rpcError ?? null };
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

const CHAT_ROW = {
  chat_id: 'c_support', participant_a: 'u_admin', participant_b: 'u_me',
  anchor_post_id: null, is_support_thread: true,
  last_message_at: '2026-05-16T12:00:00.000Z', created_at: '2026-05-16T11:00:00.000Z',
};

describe('SupabaseChatRepository — submitSupportIssue', () => {
  it('calls rpc_submit_support_issue with category + description', async () => {
    const { client, calls } = makeFakeClient({ rpcData: CHAT_ROW });
    await new SupabaseChatRepository(client).submitSupportIssue('billing', 'desc');
    expect(calls.rpcs).toEqual([
      { fn: 'rpc_submit_support_issue', args: { p_category: 'billing', p_description: 'desc' } },
    ]);
  });

  it('coalesces null category to empty string for the RPC', async () => {
    const { client, calls } = makeFakeClient({ rpcData: CHAT_ROW });
    await new SupabaseChatRepository(client).submitSupportIssue(null, 'desc');
    expect((calls.rpcs[0]?.args as { p_category: unknown }).p_category).toBe('');
  });

  it('handles SetofOptions array shape (returns first row)', async () => {
    // supabase-js sometimes wraps SetofOptions results in a one-element array.
    const { client } = makeFakeClient({ rpcData: [CHAT_ROW] });
    const out = await new SupabaseChatRepository(client).submitSupportIssue(null, 'desc');
    expect(out.chatId).toBe('c_support');
  });

  it('handles single-row shape (returns the row directly)', async () => {
    const { client } = makeFakeClient({ rpcData: CHAT_ROW });
    const out = await new SupabaseChatRepository(client).submitSupportIssue(null, 'desc');
    expect(out.chatId).toBe('c_support');
  });

  it('throws ChatError("super_admin_not_found") when the RPC returns nothing', async () => {
    const { client } = makeFakeClient({ rpcData: [] });
    await expect(
      new SupabaseChatRepository(client).submitSupportIssue(null, 'desc'),
    ).rejects.toMatchObject({ name: 'ChatError', code: 'super_admin_not_found' });
  });

  it('throws via mapChatError on RPC error', async () => {
    const { client } = makeFakeClient({ rpcError: { message: 'transport' } });
    await expect(
      new SupabaseChatRepository(client).submitSupportIssue(null, 'desc'),
    ).rejects.toBeInstanceOf(ChatError);
  });
});

describe('SupabaseChatRepository — getOrCreateSupportThread', () => {
  it('calls rpc_get_or_create_support_thread with no args', async () => {
    const { client, calls } = makeFakeClient({ rpcData: CHAT_ROW });
    await new SupabaseChatRepository(client).getOrCreateSupportThread('u_me');
    expect(calls.rpcs).toEqual([{ fn: 'rpc_get_or_create_support_thread', args: undefined }]);
  });

  it('handles SetofOptions array shape', async () => {
    const { client } = makeFakeClient({ rpcData: [CHAT_ROW] });
    const out = await new SupabaseChatRepository(client).getOrCreateSupportThread('u_me');
    expect(out.chatId).toBe('c_support');
  });

  it('throws ChatError("super_admin_not_found") when RPC returns null data', async () => {
    const { client } = makeFakeClient({ rpcData: null });
    await expect(
      new SupabaseChatRepository(client).getOrCreateSupportThread('u_me'),
    ).rejects.toMatchObject({ name: 'ChatError', code: 'super_admin_not_found' });
  });

  it('throws ChatError("super_admin_not_found") when RPC returns an empty array', async () => {
    const { client } = makeFakeClient({ rpcData: [] });
    await expect(
      new SupabaseChatRepository(client).getOrCreateSupportThread('u_me'),
    ).rejects.toMatchObject({ name: 'ChatError', code: 'super_admin_not_found' });
  });

  it('throws via mapChatError on RPC error', async () => {
    const { client } = makeFakeClient({ rpcError: { message: 'transport' } });
    await expect(
      new SupabaseChatRepository(client).getOrCreateSupportThread('u_me'),
    ).rejects.toBeInstanceOf(ChatError);
  });
});

describe('SupabaseChatRepository — getCounterpart', () => {
  const CHAT: Chat = {
    chatId: 'c_1', participantIds: ['u_me', 'u_other'], anchorPostId: null, anchorRideId: null, anchorListingId: null,
    isSupportThread: false, lastMessageAt: 't', createdAt: 't',
  };

  it('resolves the other participant when the user row is present', async () => {
    const { client } = makeFakeClient({
      userData: { user_id: 'u_other', display_name: 'Alice', avatar_url: 'a.jpg', share_handle: 'alice' },
    });
    expect(await new SupabaseChatRepository(client).getCounterpart(CHAT, 'u_me')).toEqual({
      userId: 'u_other',
      displayName: 'Alice',
      avatarUrl: 'a.jpg',
      shareHandle: 'alice',
      isDeleted: false,
    });
  });

  it('flips sides correctly when viewer is participantIds[1]', async () => {
    const flipped: Chat = { ...CHAT, participantIds: ['u_other', 'u_me'] };
    const { client } = makeFakeClient({
      userData: { user_id: 'u_other', display_name: 'A', avatar_url: null, share_handle: 'a' },
    });
    const out = await new SupabaseChatRepository(client).getCounterpart(flipped, 'u_me');
    expect(out.userId).toBe('u_other');
  });

  it('returns the deleted-counterpart shape when the other participantId is null (post-migration 0028)', async () => {
    // makeFakeClient.from would still respond — but the source code
    // short-circuits before calling Supabase. No userData needs to be set.
    const withNull: Chat = { ...CHAT, participantIds: ['u_me', null as unknown as string] };
    const { client } = makeFakeClient({});
    expect(await new SupabaseChatRepository(client).getCounterpart(withNull, 'u_me')).toEqual({
      userId: null,
      displayName: null,
      avatarUrl: null,
      shareHandle: null,
      isDeleted: true,
    });
  });

  it('returns the deleted-counterpart shape when the user lookup returns no row', async () => {
    const { client } = makeFakeClient({ userData: null });
    expect(await new SupabaseChatRepository(client).getCounterpart(CHAT, 'u_me')).toEqual({
      userId: null,
      displayName: null,
      avatarUrl: null,
      shareHandle: null,
      isDeleted: true,
    });
  });

  it('throws via mapChatError on user-lookup error', async () => {
    const { client } = makeFakeClient({ userError: { message: 'transport' } });
    await expect(
      new SupabaseChatRepository(client).getCounterpart(CHAT, 'u_me'),
    ).rejects.toBeInstanceOf(ChatError);
  });
});
