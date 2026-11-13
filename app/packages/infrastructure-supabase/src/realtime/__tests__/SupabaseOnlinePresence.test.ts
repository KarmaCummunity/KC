import { describe, it, expect, vi } from 'vitest';
import { ONLINE_PRESENCE_TOPIC, SupabaseOnlinePresence, onlineIdsFrom } from '../SupabaseOnlinePresence';
import { flush, makeFakeRealtime } from './fakeRealtime';

describe('SupabaseOnlinePresence', () => {
  it('tracks self on SUBSCRIBED and publishes the synced online set', async () => {
    const f = makeFakeRealtime();
    const p = new SupabaseOnlinePresence(f.client);
    const listener = vi.fn();
    const off = p.subscribe(listener);
    p.start('me');
    await flush();
    const ch = f.created[0]!;
    expect(ch.name).toBe(ONLINE_PRESENCE_TOPIC);
    expect(ch.config).toEqual({ private: true, presence: { key: 'me' } });
    ch.statusCb!('SUBSCRIBED');
    expect(ch.track).toHaveBeenCalledWith(expect.objectContaining({ online_at: expect.any(String) }));
    ch.presence = { me: [{}], peer: [{}] };
    ch.emit('presence', 'sync', {});
    expect(p.isOnline('peer')).toBe(true);
    expect(p.isOnline('ghost')).toBe(false);
    expect(p.isOnline(null)).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(new Set(['me', 'peer']));
    expect(p.getSnapshot().size).toBe(2);
    off();
    ch.presence = {};
    ch.emit('presence', 'sync', {});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('start is idempotent per user and switches channels on user change', async () => {
    const f = makeFakeRealtime();
    const p = new SupabaseOnlinePresence(f.client);
    p.start('a');
    p.start('a');
    await flush();
    expect(f.created).toHaveLength(1);
    p.start('b');
    await flush();
    expect(f.created).toHaveLength(2);
    expect(f.created[0]!.removed).toBe(true);
    expect(f.live).toHaveLength(1);
  });

  it('stop leaves presence, clears the set and notifies once', async () => {
    const f = makeFakeRealtime();
    const p = new SupabaseOnlinePresence(f.client);
    const listener = vi.fn();
    p.subscribe(listener);
    p.start('me');
    await flush();
    const ch = f.created[0]!;
    ch.presence = { peer: [{}] };
    ch.emit('presence', 'sync', {});
    p.stop();
    expect(ch.removed).toBe(true);
    expect(p.isOnline('peer')).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(new Set());
    const calls = listener.mock.calls.length;
    p.stop();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('ignores non-SUBSCRIBED statuses and tolerates empty state', async () => {
    const f = makeFakeRealtime();
    const p = new SupabaseOnlinePresence(f.client);
    p.start('me');
    await flush();
    f.created[0]!.statusCb!('CHANNEL_ERROR');
    expect(f.created[0]!.track).not.toHaveBeenCalled();
    expect(onlineIdsFrom({ presenceState: () => undefined as never }).size).toBe(0);
  });
});
