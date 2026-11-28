import { describe, expect, it } from 'vitest';
import { type ClientFrame, REALTIME_CLOSE, type ServerFrame } from '../../wire/realtimeWire';
import { type ChannelStatus, createApiRealtimeHost } from '../apiRealtimeHost';
import { RealtimeSocket, type SocketLike } from '../realtimeSocket';

/** A socket the test plays the server for. */
class FakeSocket implements SocketLike {
  readonly sent: ClientFrame[] = [];
  isClosed = false;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientFrame);
  }
  close(): void {
    this.serverCloses(1000);
  }
  /** The server sends a frame. */
  says(frame: ServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** The connection ends with `code`. */
  serverCloses(code: number): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.onclose?.({ code });
  }
  /** The frames of one kind this client sent. */
  framesOf<Op extends ClientFrame['op']>(op: Op): Extract<ClientFrame, { op: Op }>[] {
    return this.sent.filter((frame): frame is Extract<ClientFrame, { op: Op }> => frame.op === op);
  }
}

/** Lets the promise chain of an `await getAccessToken()` run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function world(tokens: Array<string | null> = ['token-1']) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ callback: () => void; ms: number; cancelled: boolean }> = [];
  const refreshes: boolean[] = [];
  const schedule = {
    set: (callback: () => void, ms: number) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clear: (timer: unknown) => {
      (timer as { cancelled: boolean }).cancelled = true;
    },
  };
  const socket = new RealtimeSocket({
    url: 'ws://api.kc.test/v1/realtime',
    getAccessToken: (forceRefresh) => {
      refreshes.push(forceRefresh);
      return Promise.resolve(tokens.length > 1 ? (tokens.shift() as string | null) : (tokens[0] ?? null));
    },
    createSocket: () => {
      const created = new FakeSocket();
      sockets.push(created);
      return created;
    },
    setTimer: schedule.set,
    clearTimer: schedule.clear,
  });
  const host = createApiRealtimeHost(socket, schedule);
  /** Opens the newest socket and signs it in, as the server would. */
  const serverAccepts = async () => {
    const latest = sockets.at(-1) as FakeSocket;
    latest.onopen?.({});
    await settle();
    latest.says({ op: 'ready' });
    return latest;
  };
  /** Runs the pending timers of exactly `ms`. */
  const fire = (ms: number) => {
    for (const timer of timers.filter((candidate) => candidate.ms === ms && !candidate.cancelled)) {
      timer.cancelled = true;
      timer.callback();
    }
  };
  return { host, sockets, serverAccepts, fire, refreshes, pendingDelays: () => timers.filter((timer) => !timer.cancelled).map((timer) => timer.ms) };
}

describe('the realtime channel host', () => {
  it('opens one connection for the first channel, signs in, joins, and reports SUBSCRIBED', async () => {
    const { host, sockets, serverAccepts } = world();
    const statuses: ChannelStatus[] = [];
    const received: unknown[] = [];

    host.channel('feed:public', { config: { private: true } }).on('broadcast', { event: 'new_post' }, (message) => received.push(message)).subscribe((status) => statuses.push(status));
    const server = await serverAccepts();
    const join = server.framesOf('subscribe')[0];
    server.says({ op: 'ok', ref: join?.ref ?? '' });
    server.says({ op: 'event', topic: 'feed:public', event: 'new_post', payload: { post_id: 'p1' } });
    server.says({ op: 'event', topic: 'feed:public', event: 'other', payload: {} });

    expect(sockets).toHaveLength(1);
    expect(server.sent[0]).toEqual({ op: 'auth', token: 'token-1' });
    expect(join).toMatchObject({ topic: 'feed:public', extension: 'broadcast' });
    expect(statuses).toEqual(['SUBSCRIBED']);
    // Only the event the handler was bound to.
    expect(received).toEqual([{ type: 'broadcast', event: 'new_post', payload: { post_id: 'p1' } }]);
  });

  it('joins presence only for a channel that listens to presence, and keeps who is there', async () => {
    const { host, serverAccepts } = world();
    let syncs = 0;
    const channel = host.channel('presence:online').on('presence', { event: 'sync' }, () => (syncs += 1));

    channel.subscribe();
    const server = await serverAccepts();
    server.says({ op: 'ok', ref: server.framesOf('subscribe')[0]?.ref ?? '' });
    void channel.track({ online_at: 'now' });
    server.says({ op: 'presence_state', topic: 'presence:online', members: [{ key: 'alice', meta: {} }] });
    server.says({ op: 'presence_diff', topic: 'presence:online', joins: [{ key: 'bob', meta: {} }], leaves: [{ key: 'alice', meta: {} }] });

    expect(server.framesOf('subscribe').map((frame) => frame.extension)).toEqual(['presence']);
    expect(server.framesOf('track')).toEqual([{ op: 'track', topic: 'presence:online', meta: { online_at: 'now' } }]);
    expect(Object.keys(channel.presenceState())).toEqual(['bob']);
    expect(syncs).toBe(2);
  });

  it('reports a refused join as CHANNEL_ERROR and a join with no answer as TIMED_OUT', async () => {
    const { host, serverAccepts, fire } = world();
    const refused: ChannelStatus[] = [];
    const silent: ChannelStatus[] = [];

    host.channel('user:someone-else:notifications').subscribe((status) => refused.push(status));
    host.channel('chat:c1:messages').subscribe((status) => silent.push(status));
    const server = await serverAccepts();
    server.says({ op: 'error', ref: server.framesOf('subscribe')[0]?.ref ?? '', code: 'forbidden' });
    fire(10_000);

    expect(refused).toEqual(['CHANNEL_ERROR']);
    expect(silent).toEqual(['TIMED_OUT']);
  });

  it('reconnects after a lost connection with a growing wait, re-joins, tracks again, and reports both changes', async () => {
    const { host, sockets, serverAccepts, fire, pendingDelays } = world();
    const statuses: ChannelStatus[] = [];
    const channel = host.channel('presence:online').on('presence', { event: 'sync' }, () => undefined);
    channel.subscribe((status) => statuses.push(status));
    const first = await serverAccepts();
    first.says({ op: 'ok', ref: first.framesOf('subscribe')[0]?.ref ?? '' });
    void channel.track({ device: 'phone' });

    first.serverCloses(1006);
    const waitedFirst = pendingDelays().includes(1_000);
    fire(1_000);
    (sockets.at(-1) as FakeSocket).serverCloses(1006);
    const waitedSecond = pendingDelays().includes(2_000);
    fire(2_000);
    const third = await serverAccepts();
    third.says({ op: 'ok', ref: third.framesOf('subscribe')[0]?.ref ?? '' });

    expect([waitedFirst, waitedSecond]).toEqual([true, true]);
    expect(sockets).toHaveLength(3);
    // The adapters re-read what they missed on the first SUBSCRIBED after an error.
    expect(statuses).toEqual(['SUBSCRIBED', 'CHANNEL_ERROR', 'SUBSCRIBED']);
    expect(third.framesOf('track')).toEqual([{ op: 'track', topic: 'presence:online', meta: { device: 'phone' } }]);
  });

  it('asks for a fresh token after the server refused the one it had, and does not reconnect after a protocol error', async () => {
    const refusedToken = world(['stale', 'fresh']);
    refusedToken.host.channel('feed:public').subscribe();
    (await refusedToken.serverAccepts()).serverCloses(REALTIME_CLOSE.unauthenticated);
    refusedToken.fire(1_000);
    const second = await refusedToken.serverAccepts();

    const protocolError = world();
    protocolError.host.channel('feed:public').subscribe();
    (await protocolError.serverAccepts()).serverCloses(REALTIME_CLOSE.protocol);

    expect(refusedToken.refreshes).toEqual([false, true]);
    expect(second.sent[0]).toEqual({ op: 'auth', token: 'fresh' });
    expect(protocolError.pendingDelays().filter((ms) => ms < 10_000)).toEqual([]);
    expect(protocolError.sockets).toHaveLength(1);
  });

  it('sends the member\'s new token on setAuth, once, so the connection outlives a refresh', async () => {
    const { host, serverAccepts } = world(['token-1', 'token-2']);
    host.channel('feed:public').subscribe();
    const server = await serverAccepts();

    await host.realtime.setAuth();
    await host.realtime.setAuth();

    expect(server.framesOf('auth').map((frame) => frame.token)).toEqual(['token-1', 'token-2']);
  });

  it('leaves the topic on removeChannel, forgets the channel, and closes the connection after the last one', async () => {
    const { host, serverAccepts } = world();
    const statuses: ChannelStatus[] = [];
    const channel = host.channel('chat:c1:typing').on('broadcast', { event: 'typing' }, () => undefined);
    channel.subscribe((status) => statuses.push(status));
    const server = await serverAccepts();
    server.says({ op: 'ok', ref: server.framesOf('subscribe')[0]?.ref ?? '' });

    const stale = host.getChannels().filter((candidate) => candidate.topic === 'realtime:chat:c1:typing');
    await host.removeChannel(channel);

    expect(stale).toEqual([channel]);
    expect(server.framesOf('unsubscribe')).toMatchObject([{ topic: 'chat:c1:typing', extension: 'broadcast' }]);
    expect(statuses).toEqual(['SUBSCRIBED', 'CLOSED']);
    expect(host.getChannels()).toEqual([]);
    expect(server.isClosed).toBe(true);
    // A send on a channel that is gone fails quietly.
    expect(await channel.send({ type: 'broadcast', event: 'typing', payload: {} })).toBe('error');
  });

  it('closes the connection and stays down when the member is signed out', async () => {
    const { host, sockets, pendingDelays } = world([null]);
    const statuses: ChannelStatus[] = [];
    host.channel('feed:public').subscribe((status) => statuses.push(status));

    sockets[0]?.onopen?.({});
    await settle();

    expect(sockets[0]?.sent).toEqual([]);
    expect(statuses).toEqual(['CHANNEL_ERROR']);
    // It tries again later: the member may sign in.
    expect(pendingDelays()).toContain(1_000);
  });
});
