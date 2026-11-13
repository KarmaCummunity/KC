import { describe, it, expect, vi } from 'vitest';
import { FEED_PUBLIC_TOPIC, SupabaseFeedRealtime } from '../SupabaseFeedRealtime';
import { flush, makeFakeRealtime } from '../../realtime/__tests__/fakeRealtime';

async function sub(onError?: (e: Error) => void) {
  const f = makeFakeRealtime();
  const onNewPublicPost = vi.fn();
  const unsub = new SupabaseFeedRealtime(f.client).subscribeToPublicInserts({ onNewPublicPost, onError });
  await flush();
  return { f, onNewPublicPost, unsub, ch: f.created[0]! };
}

describe('SupabaseFeedRealtime', () => {
  it('subscribes to the private feed:public Broadcast topic (0416)', async () => {
    const { ch, f } = await sub();
    expect(ch.name).toBe(FEED_PUBLIC_TOPIC);
    expect(ch.config).toEqual({ private: true });
    expect(ch.bindings).toHaveLength(1);
    expect(ch.bindings[0]).toMatchObject({ type: 'broadcast', filter: { event: 'new_post' } });
    expect(f.setAuth).toHaveBeenCalled();
  });

  it('forwards post/owner ids from new_post pings', async () => {
    const { ch, onNewPublicPost } = await sub();
    ch.emit('broadcast', 'new_post', { payload: { post_id: 'p1', owner_id: 'u1' } });
    expect(onNewPublicPost).toHaveBeenCalledWith({ postId: 'p1', ownerId: 'u1' });
  });

  it('maps malformed payloads to null ids (still counts)', async () => {
    const { ch, onNewPublicPost } = await sub();
    ch.emit('broadcast', 'new_post', { payload: { post_id: 7 } });
    ch.emit('broadcast', 'new_post', {});
    expect(onNewPublicPost).toHaveBeenNthCalledWith(1, { postId: null, ownerId: null });
    expect(onNewPublicPost).toHaveBeenNthCalledWith(2, { postId: null, ownerId: null });
  });

  it('reports channel failures only', async () => {
    const onError = vi.fn();
    const { ch } = await sub(onError);
    ch.statusCb!('SUBSCRIBED');
    ch.statusCb!('CHANNEL_ERROR');
    ch.statusCb!('TIMED_OUT');
    expect(onError).toHaveBeenCalledTimes(2);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('feed channel channel_error');
  });

  it('works without an onError sink', async () => {
    const { ch } = await sub();
    expect(() => ch.statusCb!('CHANNEL_ERROR')).not.toThrow();
  });

  it('unsubscribe removes the channel; remount re-creates a fresh one', async () => {
    const { f, unsub } = await sub();
    unsub();
    expect(f.live).toHaveLength(0);
    const again = new SupabaseFeedRealtime(f.client).subscribeToPublicInserts({ onNewPublicPost: vi.fn() });
    await flush();
    expect(f.created).toHaveLength(2);
    expect(f.live).toHaveLength(1);
    again();
  });

  it('unsubscribe before open leaks no channel', async () => {
    const f = makeFakeRealtime();
    const unsub = new SupabaseFeedRealtime(f.client).subscribeToPublicInserts({ onNewPublicPost: vi.fn() });
    unsub();
    await flush();
    expect(f.live).toHaveLength(0);
  });
});
