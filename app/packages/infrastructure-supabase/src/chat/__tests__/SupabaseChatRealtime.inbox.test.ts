import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseChatRealtime } from '../SupabaseChatRealtime';
import { flush, makeFakeRealtime } from '../../realtime/__tests__/fakeRealtime';

type RpcResult = { data: unknown; error: unknown };

/** The fake realtime client plus a recording `rpc` answering `chat_unread_total`. */
function setup(rpcImpl: () => Promise<RpcResult> = async () => ({ data: 0, error: null })) {
  const f = makeFakeRealtime();
  const rpcCalls: string[] = [];
  const client = {
    ...f.client,
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return rpcImpl();
    },
  } as unknown as SupabaseClient;
  return { f, client, rpcCalls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function sub(client: SupabaseClient, options?: { getSnapshotEpoch?: () => number }) {
  const cb = { onInboxChanged: vi.fn(), onUnreadTotalChanged: vi.fn() };
  const unsub = new SupabaseChatRealtime(client as never).subscribeToInbox('u_me', cb, options);
  await flush();
  return { cb, unsub };
}

const ping = (channel: { emit: (type: string, event: string, payload: unknown) => void }, payload: unknown = {}) =>
  channel.emit('broadcast', 'chat_updated', { payload });

describe('SupabaseChatRealtime — subscribeToInbox', () => {
  it('joins the private user:<id>:chats topic with a single chat_updated listener', async () => {
    const { f, client } = setup();
    await sub(client);
    const channel = f.created[0]!;
    expect(channel.name).toBe('user:u_me:chats');
    expect(channel.config).toEqual({ private: true });
    expect(channel.bindings.map((b) => [b.type, b.filter.event])).toEqual([['broadcast', 'chat_updated']]);
  });

  it('chat_updated → onInboxChanged with the ids it carries', async () => {
    const { f, client } = setup();
    const { cb } = await sub(client);
    ping(f.created[0]!, { chat_id: 'c_1', last_message_at: '2026-05-16T12:00:00.000Z' });
    expect(cb.onInboxChanged).toHaveBeenCalledWith({ chatId: 'c_1', lastMessageAt: '2026-05-16T12:00:00.000Z' });
  });

  it('accepts an event without ids (hide / read pings carry only the chat id)', async () => {
    const { f, client } = setup();
    const { cb } = await sub(client);
    ping(f.created[0]!, {});
    expect(cb.onInboxChanged).toHaveBeenCalledWith({ chatId: null, lastMessageAt: null });
  });

  it('debounces the unread read: rapid events collapse into one chat_unread_total call after 200ms', async () => {
    const { f, client, rpcCalls } = setup(async () => ({ data: 5, error: null }));
    const { cb } = await sub(client);
    ping(f.created[0]!);
    ping(f.created[0]!);
    ping(f.created[0]!);
    expect(rpcCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(rpcCalls).toEqual(['chat_unread_total']);
    expect(cb.onUnreadTotalChanged).toHaveBeenCalledWith(5);
  });

  it('does not call onUnreadTotalChanged when the RPC errors', async () => {
    const { f, client } = setup(async () => ({ data: null, error: { message: 'boom' } }));
    const { cb } = await sub(client);
    ping(f.created[0]!);
    await vi.advanceTimersByTimeAsync(200);
    expect(cb.onUnreadTotalChanged).not.toHaveBeenCalled();
  });

  it('does not call onUnreadTotalChanged when the function is missing (degrade rule)', async () => {
    const { f, client } = setup(async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }));
    const { cb } = await sub(client);
    ping(f.created[0]!);
    await vi.advanceTimersByTimeAsync(200);
    expect(cb.onUnreadTotalChanged).not.toHaveBeenCalled();
  });

  it('drops a stale result when the snapshot epoch changes while the RPC is in flight', async () => {
    let epoch = 1;
    let resolveRpc!: (v: RpcResult) => void;
    const pending = new Promise<RpcResult>((resolve) => {
      resolveRpc = resolve;
    });
    const { f, client } = setup(() => pending);
    const { cb } = await sub(client, { getSnapshotEpoch: () => epoch });

    ping(f.created[0]!);
    await vi.advanceTimersByTimeAsync(200); // the timer ran; epoch 1 captured; the RPC is pending
    epoch = 2; // the inbox snapshot was rebuilt meanwhile
    resolveRpc({ data: 9, error: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onUnreadTotalChanged).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the channel and clears a pending debounce timer', async () => {
    const { f, client, rpcCalls } = setup();
    const { unsub } = await sub(client);
    ping(f.created[0]!); // arm the timer
    unsub();
    expect(f.live).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(rpcCalls).toHaveLength(0);
  });
});
