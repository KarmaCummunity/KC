import { describe, it, expect, vi } from 'vitest';
import { SupabaseChatRealtime, broadcastRecord } from '../SupabaseChatRealtime';
import { flush, makeFakeRealtime } from '../../realtime/__tests__/fakeRealtime';

// The row the messages trigger broadcasts (`to_jsonb(new)`).
const MSG_ROW = {
  id: 'm_1',
  chat_id: 'c_1',
  sender_id: 'u_1',
  kind: 'user',
  body: 'hi',
  system_payload: null,
  media_payload: null,
  created_at: '2026-05-16T12:00:00.000Z',
};

const insertEnvelope = (record: unknown) => ({ payload: { record } });

async function sub(extra: Record<string, unknown> = {}) {
  const f = makeFakeRealtime();
  const cb = { onMessage: vi.fn(), onReadMarker: vi.fn(), onError: vi.fn(), ...extra };
  const unsub = new SupabaseChatRealtime(f.client).subscribeToChat('c_1', cb);
  await flush();
  return { f, cb, unsub, topic: f.created.find((c) => c.name === 'chat:c_1:messages')! };
}

describe('SupabaseChatRealtime — subscribeToChat', () => {
  it('listens on the private chat:<id>:messages Broadcast topic and nothing else (no postgres_changes)', async () => {
    const { f, topic } = await sub();
    expect(topic.config).toEqual({ private: true });
    expect(topic.bindings.map((b) => [b.type, b.filter.event])).toEqual([
      ['broadcast', 'INSERT'],
      ['broadcast', 'read'],
      ['broadcast', 'chat_updated'],
    ]);
    expect(f.created).toHaveLength(1);
    expect(f.setAuth).toHaveBeenCalled();
  });

  it('INSERT broadcast → onMessage with the mapped row (delivered, unread by the other member yet)', async () => {
    const { topic, cb } = await sub();
    topic.emit('broadcast', 'INSERT', insertEnvelope(MSG_ROW));
    expect(cb.onMessage).toHaveBeenCalledTimes(1);
    expect(cb.onMessage.mock.calls[0]?.[0]).toMatchObject({ messageId: 'm_1', chatId: 'c_1', status: 'delivered' });
  });

  it('read broadcast → onReadMarker with the reader and the marker (FR-CHAT-011)', async () => {
    const { topic, cb } = await sub();
    topic.emit('broadcast', 'read', { payload: { user_id: 'u_2', last_read_at: '2026-05-16T12:00:05.000Z' } });
    expect(cb.onReadMarker).toHaveBeenCalledWith({ userId: 'u_2', lastReadAt: '2026-05-16T12:00:05.000Z' });
  });

  it('ignores a read broadcast without a reader or a marker', async () => {
    const { topic, cb } = await sub();
    topic.emit('broadcast', 'read', { payload: { user_id: 'u_2' } });
    topic.emit('broadcast', 'read', {});
    expect(cb.onReadMarker).not.toHaveBeenCalled();
  });

  it('chat_updated broadcast → onChatChanged with the new pinned post (FR-CHAT-014 AC6)', async () => {
    const onChatChanged = vi.fn();
    const { topic } = await sub({ onChatChanged });
    topic.emit('broadcast', 'chat_updated', { payload: { chat_id: 'c_1', anchor_post_id: 'p_9' } });
    topic.emit('broadcast', 'chat_updated', { payload: { chat_id: 'c_1', anchor_post_id: null } });
    expect(onChatChanged).toHaveBeenNthCalledWith(1, { chatId: 'c_1', anchorPostId: 'p_9' });
    expect(onChatChanged).toHaveBeenNthCalledWith(2, { chatId: 'c_1', anchorPostId: null });
  });

  it('ignores an INSERT broadcast without a record', async () => {
    const { topic, cb } = await sub();
    topic.emit('broadcast', 'INSERT', { payload: { op: 'INSERT' } });
    topic.emit('broadcast', 'INSERT', {});
    expect(cb.onMessage).not.toHaveBeenCalled();
  });

  it('routes CHANNEL_ERROR / TIMED_OUT to onError, not SUBSCRIBED', async () => {
    const { topic, cb } = await sub();
    topic.statusCb!('SUBSCRIBED');
    topic.statusCb!('CHANNEL_ERROR');
    topic.statusCb!('TIMED_OUT');
    expect(cb.onError).toHaveBeenCalledTimes(2);
    expect(cb.onError.mock.calls[0]?.[0]?.message).toBe('chat channel channel_error');
    expect(cb.onError.mock.calls[1]?.[0]?.message).toBe('chat channel timed_out');
  });

  it('unsubscribe removes the channel it opened', async () => {
    const { f, unsub } = await sub();
    expect(f.live).toHaveLength(1);
    unsub();
    expect(f.live).toHaveLength(0);
  });

  it('unsubscribe before the channel opens leaks nothing', async () => {
    const f = makeFakeRealtime();
    const unsub = new SupabaseChatRealtime(f.client).subscribeToChat('c_1', {
      onMessage: vi.fn(), onReadMarker: vi.fn(), onError: vi.fn(),
    });
    unsub();
    await flush();
    expect(f.live).toHaveLength(0);
  });
});

describe('broadcastRecord', () => {
  it('extracts the record or returns null', () => {
    expect(broadcastRecord({ payload: { record: { a: 1 } } })).toEqual({ a: 1 });
    expect(broadcastRecord({ payload: { record: null } })).toBeNull();
    expect(broadcastRecord({})).toBeNull();
  });
});
