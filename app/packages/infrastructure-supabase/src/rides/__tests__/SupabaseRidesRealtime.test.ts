import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRidesRealtime } from '../SupabaseRidesRealtime';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface OnCall {
  event: string;
  config: any;
  handler: (payload: unknown) => void;
}

interface FakeChannel {
  topic: string;
  onCalls: OnCall[];
  statusCb?: (status: string) => void;
}

interface FakeClient {
  client: SupabaseClient<any>;
  channels: FakeChannel[];
  removed: FakeChannel[];
}

function makeFakeClient(): FakeClient {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const builderToFc = new WeakMap<object, FakeChannel>();

  const client = {
    channel: (topic: string) => {
      const fc: FakeChannel = { topic, onCalls: [] };
      channels.push(fc);
      const builder: any = {
        on: (event: string, config: any, handler: (payload: unknown) => void) => {
          fc.onCalls.push({ event, config, handler });
          return builder;
        },
        subscribe: (statusCb: (status: string) => void) => {
          fc.statusCb = statusCb;
          return builder;
        },
      };
      builderToFc.set(builder, fc);
      return builder;
    },
    removeChannel: (ch: object) => {
      const fc = builderToFc.get(ch);
      if (fc) removed.push(fc);
      return Promise.resolve();
    },
  } as unknown as SupabaseClient<any>;

  return { client, channels, removed };
}

describe('SupabaseRidesRealtime.subscribeToPublicRideInserts', () => {
  it('creates a channel with a unique rides:public-feed topic', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    repo.subscribeToPublicRideInserts({ onChange: vi.fn() });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.topic).toMatch(
      /^rides:public-feed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('produces a different topic per subscription', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    repo.subscribeToPublicRideInserts({ onChange: vi.fn() });
    repo.subscribeToPublicRideInserts({ onChange: vi.fn() });
    expect(channels[0]?.topic).not.toBe(channels[1]?.topic);
  });

  it('binds INSERT/public/ride_listings with visibility=eq.Public filter', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    repo.subscribeToPublicRideInserts({ onChange: vi.fn() });
    expect(channels[0]?.onCalls[0]?.config).toEqual({
      event: 'INSERT',
      schema: 'public',
      table: 'ride_listings',
      filter: 'visibility=eq.Public',
    });
  });

  it('invokes onChange when postgres_changes fires', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const onChange = vi.fn();
    repo.subscribeToPublicRideInserts({ onChange });
    channels[0]!.onCalls[0]!.handler({});
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('translates CHANNEL_ERROR / TIMED_OUT into Error via onError', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const onError = vi.fn();
    repo.subscribeToPublicRideInserts({ onChange: vi.fn(), onError });
    channels[0]!.statusCb!('CHANNEL_ERROR');
    channels[0]!.statusCb!('TIMED_OUT');
    channels[0]!.statusCb!('SUBSCRIBED');
    expect(onError).toHaveBeenCalledTimes(2);
    expect((onError.mock.calls[0]![0] as Error).message).toContain('channel_error');
    expect((onError.mock.calls[1]![0] as Error).message).toContain('timed_out');
  });

  it('safely handles CHANNEL_ERROR when onError callback is omitted', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    repo.subscribeToPublicRideInserts({ onChange: vi.fn() });
    expect(() => channels[0]!.statusCb!('CHANNEL_ERROR')).not.toThrow();
  });

  it('returns an unsubscribe that removes the channel', () => {
    const { client, channels, removed } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const unsub = repo.subscribeToPublicRideInserts({ onChange: vi.fn() });
    unsub();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(channels[0]);
  });
});

describe('SupabaseRidesRealtime.subscribeToUserParticipantUpdates', () => {
  it('filters by user_id and listens for UPDATE on ride_participants', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    repo.subscribeToUserParticipantUpdates('u_me', { onChange: vi.fn() });

    expect(channels[0]?.topic).toMatch(/^rides:participants:user:u_me:/);
    expect(channels[0]?.onCalls[0]?.config).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'ride_participants',
      filter: 'user_id=eq.u_me',
    });
  });

  it('fires onChange when an update payload arrives', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const onChange = vi.fn();
    repo.subscribeToUserParticipantUpdates('u_me', { onChange });
    channels[0]!.onCalls[0]!.handler({});
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('translates CHANNEL_ERROR / TIMED_OUT via onError callback', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const onError = vi.fn();
    repo.subscribeToUserParticipantUpdates('u_me', { onChange: vi.fn(), onError });
    channels[0]!.statusCb!('CHANNEL_ERROR');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('channel_error') }),
    );
  });

  it('returns an unsubscribe that removes the channel', () => {
    const { client, removed } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const unsub = repo.subscribeToUserParticipantUpdates('u_me', { onChange: vi.fn() });
    unsub();
    expect(removed).toHaveLength(1);
  });
});

describe('SupabaseRidesRealtime.subscribeToRideParticipantInserts', () => {
  it('filters by ride_id and listens for INSERT on ride_participants', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    repo.subscribeToRideParticipantInserts('r1', { onChange: vi.fn() });

    expect(channels[0]?.topic).toMatch(/^rides:participants:ride:r1:/);
    expect(channels[0]?.onCalls[0]?.config).toEqual({
      event: 'INSERT',
      schema: 'public',
      table: 'ride_participants',
      filter: 'ride_id=eq.r1',
    });
  });

  it('fires onChange when an insert payload arrives', () => {
    const { client, channels } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const onChange = vi.fn();
    repo.subscribeToRideParticipantInserts('r1', { onChange });
    channels[0]!.onCalls[0]!.handler({});
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('translates status errors via onError callback and handles unsubscribe', () => {
    const { client, channels, removed } = makeFakeClient();
    const repo = new SupabaseRidesRealtime(client);
    const onError = vi.fn();
    const unsub = repo.subscribeToRideParticipantInserts('r1', { onChange: vi.fn(), onError });
    channels[0]!.statusCb!('TIMED_OUT');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('timed_out') }),
    );
    unsub();
    expect(removed).toHaveLength(1);
  });
});
