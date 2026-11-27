import { REALTIME_CLOSE, type ServerFrame } from '@kc/infrastructure-api';
import { describe, expect, it } from 'vitest';
import { InvalidAccessTokenError } from '../../identity/accessTokenVerifier';
import type { CallerIdentity } from '../../identity/callerIdentity';
import { InMemoryEphemeralEvents } from '../ephemeralEvents';
import { MAX_FRAMES_PER_SECOND, MAX_SUBSCRIPTIONS, parseFrame, RealtimeConnection } from '../realtimeConnection';
import { RealtimeHub } from '../realtimeHub';
import type { TopicAccess } from '../topicAuthorizer';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const callerOf = (userId: string, exp = 2_000_000_000): CallerIdentity => ({ userId, claims: { sub: userId, role: 'authenticated', exp } });

/** One hub shared by every connection of a test, as on one server. */
function world(access: (topic: string, userId: string) => TopicAccess = () => ({ receive: true, send: true })) {
  const hub = new RealtimeHub();
  const ephemeral = new InMemoryEphemeralEvents(hub);
  const reported: unknown[] = [];
  let clock = 0;
  /** A connection whose socket records what it was sent; tokens are user ids, `expired` is refused. */
  const connect = () => {
    const sent: ServerFrame[] = [];
    const closes: number[] = [];
    const connection = new RealtimeConnection(
      { send: (text) => sent.push(JSON.parse(text) as ServerFrame), close: (code) => closes.push(code) },
      {
        verifier: { verify: (token) => (token === 'expired' ? Promise.reject(new InvalidAccessTokenError('ERR_JWT_EXPIRED')) : Promise.resolve(callerOf(token))) },
        authorizer: { accessOf: (caller, topic) => Promise.resolve(access(topic, caller.userId)) },
        hub,
        ephemeral,
        report: (error) => reported.push(error),
        now: () => clock,
      },
    );
    const say = (frame: unknown) => connection.receive(typeof frame === 'string' ? frame : JSON.stringify(frame));
    return { connection, sent, closes, say };
  };
  /** A connection that has already signed in as `userId`. */
  const signedIn = async (userId: string) => {
    const client = connect();
    await client.say({ op: 'auth', token: userId });
    client.sent.length = 0;
    return client;
  };
  return { hub, connect, signedIn, reported, advance: (ms: number) => (clock += ms) };
}

describe('RealtimeConnection: signing in', () => {
  it('answers a valid token with `ready`', async () => {
    const { connect } = world();
    const client = connect();

    await client.say({ op: 'auth', token: ALICE });

    expect(client.sent).toEqual([{ op: 'ready' }]);
    expect(client.connection.tokenExpiresAt).toBe(2_000_000_000_000);
  });

  it('closes a connection whose token is refused, and one that speaks before signing in', async () => {
    const { connect } = world();
    const refused = connect();
    const early = connect();

    await refused.say({ op: 'auth', token: 'expired' });
    await early.say({ op: 'subscribe', ref: '1', topic: 'feed:public', extension: 'broadcast' });

    expect(refused.closes).toEqual([REALTIME_CLOSE.unauthenticated]);
    expect(early.closes).toEqual([REALTIME_CLOSE.unauthenticated]);
    expect([...refused.sent, ...early.sent]).toEqual([]);
  });

  it('closes on a token of another member: a connection belongs to one member for its whole life', async () => {
    const { signedIn } = world();
    const client = await signedIn(ALICE);

    await client.say({ op: 'auth', token: BOB });

    expect(client.closes).toEqual([REALTIME_CLOSE.unauthenticated]);
  });

  it('withdraws the subscriptions a member may no longer hold when their token is replaced', async () => {
    let chatOpen = true;
    const { signedIn, hub } = world((topic) => ({ receive: topic !== 'chat:c1:messages' || chatOpen, send: false }));
    const client = await signedIn(ALICE);
    await client.say({ op: 'subscribe', ref: 'chat', topic: 'chat:c1:messages', extension: 'broadcast' });
    await client.say({ op: 'subscribe', ref: 'feed', topic: 'feed:public', extension: 'broadcast' });
    client.sent.length = 0;
    chatOpen = false;

    await client.say({ op: 'auth', token: ALICE });

    expect(client.sent).toEqual([{ op: 'error', ref: 'chat', code: 'forbidden' }]);
    expect(hub.deliver('chat:c1:messages', 'broadcast', { op: 'pong' })).toBe(0);
    expect(hub.deliver('feed:public', 'broadcast', { op: 'pong' })).toBe(1);
  });
});

describe('RealtimeConnection: subscriptions', () => {
  it('joins a topic the policy allows and then receives its events', async () => {
    const { signedIn, hub } = world();
    const client = await signedIn(ALICE);

    await client.say({ op: 'subscribe', ref: 'r1', topic: `user:${ALICE}:notifications`, extension: 'broadcast' });
    hub.deliver(`user:${ALICE}:notifications`, 'broadcast', { op: 'event', topic: `user:${ALICE}:notifications`, event: 'badge', payload: { unread: 3 } });

    expect(client.sent).toEqual([
      { op: 'ok', ref: 'r1' },
      { op: 'event', topic: `user:${ALICE}:notifications`, event: 'badge', payload: { unread: 3 } },
    ]);
  });

  it('refuses a topic the policy closes, and nothing of that topic reaches the connection', async () => {
    const { signedIn, hub } = world((topic) => ({ receive: topic === 'feed:public', send: false }));
    const client = await signedIn(ALICE);

    await client.say({ op: 'subscribe', ref: 'r1', topic: `user:${BOB}:notifications`, extension: 'broadcast' });

    expect(client.sent).toEqual([{ op: 'error', ref: 'r1', code: 'forbidden' }]);
    expect(hub.deliver(`user:${BOB}:notifications`, 'broadcast', { op: 'pong' })).toBe(0);
  });

  it('stops delivering after an unsubscribe and after the socket closes', async () => {
    const { signedIn, hub } = world();
    const left = await signedIn(ALICE);
    const gone = await signedIn(BOB);
    for (const client of [left, gone]) await client.say({ op: 'subscribe', ref: 'r1', topic: 'feed:public', extension: 'broadcast' });

    await left.say({ op: 'unsubscribe', ref: 'r2', topic: 'feed:public', extension: 'broadcast' });
    gone.connection.release();

    expect(left.sent.at(-1)).toEqual({ op: 'ok', ref: 'r2' });
    expect(hub.deliver('feed:public', 'broadcast', { op: 'pong' })).toBe(0);
    expect(hub.topicCount).toBe(0);
  });

  it('holds at most the allowed number of subscriptions; joining a held topic again is not a new one', async () => {
    const { signedIn, advance } = world();
    const client = await signedIn(ALICE);
    for (let index = 0; index < MAX_SUBSCRIPTIONS; index += 1) {
      await client.say({ op: 'subscribe', ref: `r${index}`, topic: `topic:${index}`, extension: 'broadcast' });
      // Keep to the allowed pace: this test is about the subscription limit, not the frame rate.
      advance(1000 / MAX_FRAMES_PER_SECOND);
    }
    client.sent.length = 0;

    await client.say({ op: 'subscribe', ref: 'again', topic: 'topic:0', extension: 'broadcast' });
    await client.say({ op: 'subscribe', ref: 'more', topic: 'topic:new', extension: 'broadcast' });

    expect(client.sent).toEqual([
      { op: 'ok', ref: 'again' },
      { op: 'error', ref: 'more', code: 'too_many_subscriptions' },
    ]);
  });

  it('answers `unavailable` when the policy could not be checked, and reports it', async () => {
    const failure = new Error('database down');
    const { signedIn, reported } = world(() => {
      throw failure;
    });
    const client = await signedIn(ALICE);

    await client.say({ op: 'subscribe', ref: 'r1', topic: 'feed:public', extension: 'broadcast' });

    expect(client.sent).toEqual([{ op: 'error', ref: 'r1', code: 'unavailable' }]);
    expect(reported).toEqual([failure]);
  });
});

describe('RealtimeConnection: client-sent events and presence', () => {
  const TYPING = 'chat:c1:typing';
  const PRESENCE = 'chat:c1:presence';

  it('sends a typing event to the topic\'s other members, not back to the sender', async () => {
    const { signedIn } = world();
    const alice = await signedIn(ALICE);
    const bob = await signedIn(BOB);
    for (const client of [alice, bob]) await client.say({ op: 'subscribe', ref: 'r', topic: TYPING, extension: 'broadcast' });
    alice.sent.length = bob.sent.length = 0;

    await alice.say({ op: 'broadcast', topic: TYPING, event: 'typing', payload: { userId: ALICE } });

    expect(bob.sent).toEqual([{ op: 'event', topic: TYPING, event: 'typing', payload: { userId: ALICE } }]);
    expect(alice.sent).toEqual([]);
  });

  it('refuses an event on a topic the member has not joined or may not send on', async () => {
    const { signedIn } = world((topic) => ({ receive: true, send: topic === TYPING }));
    const alice = await signedIn(ALICE);
    await alice.say({ op: 'subscribe', ref: 'r', topic: 'chat:c1:messages', extension: 'broadcast' });
    alice.sent.length = 0;

    await alice.say({ op: 'broadcast', topic: TYPING, event: 'typing', payload: null });
    await alice.say({ op: 'broadcast', topic: 'chat:c1:messages', event: 'INSERT', payload: { body: 'forged' } });

    expect(alice.sent).toEqual([
      { op: 'error', code: 'forbidden' },
      { op: 'error', code: 'forbidden' },
    ]);
  });

  it('shows who is present: the state on joining, then joins and leaves, keyed by the verified member', async () => {
    const { signedIn } = world();
    const alice = await signedIn(ALICE);
    const bob = await signedIn(BOB);
    await alice.say({ op: 'subscribe', ref: 'r', topic: PRESENCE, extension: 'presence' });
    // The client cannot choose its key: whatever it puts in `meta`, the key is the member the token proved.
    await alice.say({ op: 'track', topic: PRESENCE, meta: { key: BOB, device: 'phone' } });

    await bob.say({ op: 'subscribe', ref: 'r', topic: PRESENCE, extension: 'presence' });
    await bob.say({ op: 'track', topic: PRESENCE, meta: {} });
    alice.connection.release();

    expect(bob.sent).toEqual([
      { op: 'ok', ref: 'r' },
      { op: 'presence_state', topic: PRESENCE, members: [{ key: ALICE, meta: { key: BOB, device: 'phone' } }] },
      { op: 'presence_diff', topic: PRESENCE, joins: [{ key: BOB, meta: {} }], leaves: [] },
      { op: 'presence_diff', topic: PRESENCE, joins: [], leaves: [{ key: ALICE, meta: { key: BOB, device: 'phone' } }] },
    ]);
  });

  it('counts a member once however many devices they have, and reports the leave with the last one', async () => {
    const { signedIn } = world();
    const phone = await signedIn(ALICE);
    const laptop = await signedIn(ALICE);
    const watcher = await signedIn(BOB);
    for (const client of [phone, laptop, watcher]) await client.say({ op: 'subscribe', ref: 'r', topic: PRESENCE, extension: 'presence' });
    watcher.sent.length = 0;

    await phone.say({ op: 'track', topic: PRESENCE, meta: {} });
    await laptop.say({ op: 'track', topic: PRESENCE, meta: {} });
    await phone.say({ op: 'untrack', topic: PRESENCE });
    await laptop.say({ op: 'untrack', topic: PRESENCE });

    expect(watcher.sent.map((frame) => (frame.op === 'presence_diff' ? [frame.joins.length, frame.leaves.length] : frame.op))).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('refuses to track on a topic the member may not send on', async () => {
    const { signedIn } = world(() => ({ receive: true, send: false }));
    const alice = await signedIn(ALICE);
    await alice.say({ op: 'subscribe', ref: 'r', topic: 'presence:online', extension: 'presence' });
    alice.sent.length = 0;

    await alice.say({ op: 'track', topic: 'presence:online', meta: {} });

    expect(alice.sent).toEqual([{ op: 'error', code: 'forbidden' }]);
  });
});

describe('RealtimeConnection: protocol limits', () => {
  it('answers a ping, and closes on a frame it does not understand', async () => {
    const { signedIn } = world();
    const client = await signedIn(ALICE);

    await client.say({ op: 'ping' });
    await client.say('not json');

    expect(client.sent).toEqual([{ op: 'pong' }]);
    expect(client.closes).toEqual([REALTIME_CLOSE.protocol]);
  });

  it('closes a connection that sends frames faster than allowed, and lets it resume the pace after a pause', async () => {
    const { signedIn, advance } = world();
    const flood = await signedIn(ALICE);
    const paced = await signedIn(BOB);

    for (let index = 0; index < 3 * MAX_FRAMES_PER_SECOND; index += 1) await flood.say({ op: 'ping' });
    for (let index = 0; index < 3 * MAX_FRAMES_PER_SECOND; index += 1) {
      await paced.say({ op: 'ping' });
      advance(1000 / MAX_FRAMES_PER_SECOND);
    }

    expect(flood.closes).toEqual([REALTIME_CLOSE.tooFast]);
    expect(paced.closes).toEqual([]);
  });
});

describe('parseFrame', () => {
  it('keeps only the fields of a known frame', () => {
    expect(parseFrame(JSON.stringify({ op: 'subscribe', ref: 'r', topic: 't', extension: 'broadcast', extra: 1 }))).toEqual({ op: 'subscribe', ref: 'r', topic: 't', extension: 'broadcast' });
    expect(parseFrame(JSON.stringify({ op: 'track', topic: 't' }))).toEqual({ op: 'track', topic: 't', meta: {} });
  });

  it.each([
    ['text that is not JSON', 'nope'],
    ['a JSON value that is not an object', '[1]'],
    ['an unknown op', '{"op":"admin"}'],
    ['a subscribe without a topic', '{"op":"subscribe","ref":"r","extension":"broadcast"}'],
    ['an unknown extension', '{"op":"subscribe","ref":"r","topic":"t","extension":"postgres_changes"}'],
    ['an auth without a token', '{"op":"auth","token":""}'],
    ['a track whose meta is a list', '{"op":"track","topic":"t","meta":[]}'],
    ['an event name that is too long', JSON.stringify({ op: 'broadcast', topic: 't', event: 'e'.repeat(65) })],
  ])('refuses %s', (_label, text) => {
    expect(parseFrame(text)).toBeNull();
  });
});
