import 'reflect-metadata';
import { type ClientFrame, REALTIME_CLOSE, REALTIME_PATH, type ServerFrame } from '@kc/infrastructure-api';
import { SupabaseChatRepository } from '@kc/infrastructure-supabase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

/** How long a test waits for a frame that should arrive. */
const FRAME_TIMEOUT_MS = 8_000;
/** How long a test waits to be sure that no frame arrives. */
const QUIET_MS = 400;

/** A client of the realtime endpoint over a real WebSocket, with the frames it received. */
interface TestSocket {
  readonly frames: ServerFrame[];
  say(frame: ClientFrame): void;
  /** Resolves with the first frame, already received or still to come, that `matches`. */
  next(matches: (frame: ServerFrame) => boolean): Promise<ServerFrame>;
  /** Resolves with the close code. */
  readonly closed: Promise<number>;
  close(): void;
}

/**
 * The realtime gateway end to end (ADR-011): a real WebSocket, the real
 * policies on `realtime.messages`, and events the database itself sends.
 */
describe.skipIf(!KC_DATABASE_URL)('Realtime gateway on the KC schema', () => {
  const database = new KcTestDatabase();
  const open: TestSocket[] = [];
  let gateway: KcGateway;
  let url: string;
  let alice: TestMember;
  let bob: TestMember;
  let outsider: TestMember;
  let chatId: string;
  let refSequence = 0;

  function connect(): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const frames: ServerFrame[] = [];
      const waiting: Array<{ matches: (frame: ServerFrame) => boolean; resolve: (frame: ServerFrame) => void; reject: (error: Error) => void }> = [];
      const closed = new Promise<number>((resolveClose) =>
        socket.addEventListener('close', (event) => {
          // A test that still waits for a frame learns at once that none will come, and why.
          for (const waiter of waiting.splice(0)) waiter.reject(new Error(`the server closed the socket with code ${event.code}`));
          resolveClose(event.code);
        }),
      );
      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as ServerFrame;
        frames.push(frame);
        const index = waiting.findIndex((waiter) => waiter.matches(frame));
        if (index >= 0) waiting.splice(index, 1)[0]?.resolve(frame);
      });
      socket.addEventListener('error', () => reject(new Error('the WebSocket could not connect')));
      socket.addEventListener('open', () => {
        const client: TestSocket = {
          frames,
          closed,
          say: (frame) => socket.send(JSON.stringify(frame)),
          close: () => socket.close(),
          next: (matches) => {
            const already = frames.find(matches);
            if (already) return Promise.resolve(already);
            return new Promise((resolveFrame, rejectFrame) => {
              const timer = setTimeout(() => rejectFrame(new Error(`no matching frame within ${FRAME_TIMEOUT_MS} ms; received ${JSON.stringify(frames)}`)), FRAME_TIMEOUT_MS);
              waiting.push({ matches, resolve: (frame) => (clearTimeout(timer), resolveFrame(frame)), reject: (error) => (clearTimeout(timer), rejectFrame(error)) });
            });
          },
        };
        open.push(client);
        resolve(client);
      });
    });
  }

  /** A socket signed in as `member`. */
  async function signedIn(member: TestMember): Promise<TestSocket> {
    const socket = await connect();
    socket.say({ op: 'auth', token: await gateway.issuer.sign(member.userId) });
    await socket.next((frame) => frame.op === 'ready');
    return socket;
  }

  /** Subscribes and resolves with the server's answer to that subscription. */
  async function subscribe(socket: TestSocket, topic: string, extension: 'broadcast' | 'presence' = 'broadcast'): Promise<ServerFrame> {
    // A ref is a short correlation id of the client's choosing (the server refuses a long one).
    const ref = `r${(refSequence += 1)}`;
    socket.say({ op: 'subscribe', ref, topic, extension });
    return socket.next((frame) => (frame.op === 'ok' || frame.op === 'error') && frame.ref === ref);
  }

  const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  /** Sends an event the way the database does: through the function every trigger uses. */
  const databaseSends = (topic: string, event: string, payload: unknown) => database.admin.query('select kc_private.broadcast($1, $2, $3::jsonb)', [topic, event, JSON.stringify(payload)]);
  const eventsOf = (socket: TestSocket) => socket.frames.filter((frame) => frame.op === 'event');

  beforeAll(async () => {
    gateway = await startKcGateway();
    url = `${(await gateway.listen()).replace('http', 'ws')}${REALTIME_PATH}`;
    [alice, bob, outsider] = await Promise.all([database.newMember(), database.newMember(), database.newMember()]);
    chatId = (await new SupabaseChatRepository(database.clientFor(alice.caller)).findOrCreateChat(alice.userId, bob.userId)).chatId;
  });

  afterEach(() => {
    for (const socket of open.splice(0)) socket.close();
  });

  afterAll(async () => {
    await gateway?.app.close();
    await database.close();
  });

  it('brings an event the database sends to the member it is for, and to nobody else', async () => {
    const topic = `user:${alice.userId}:notifications`;
    const hers = await signedIn(alice);
    const his = await signedIn(bob);

    const allowed = await subscribe(hers, topic);
    const refused = await subscribe(his, topic);
    await databaseSends(topic, 'badge', { unread: 3 });
    const event = await hers.next((frame) => frame.op === 'event');
    await quiet();

    expect(allowed.op).toBe('ok');
    expect(refused).toMatchObject({ op: 'error', code: 'forbidden' });
    expect(event).toEqual({ op: 'event', topic, event: 'badge', payload: { unread: 3 } });
    // Delivered once, and never to the member who was refused.
    expect(eventsOf(hers)).toHaveLength(1);
    expect(eventsOf(his)).toEqual([]);
  });

  it('still delivers an event whose notification was lost, once, on the next sweep', async () => {
    const topic = `user:${bob.userId}:notifications`;
    const his = await signedIn(bob);
    await subscribe(his, topic);

    // A row stored without ringing the bell: what a lost notification leaves behind.
    await database.admin.query("insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'badge', '{\"unread\": 1}', true)", [topic]);
    const swept = await his.next((frame) => frame.op === 'event');
    // A notified event is not delivered a second time by the sweeps that follow it.
    await databaseSends(topic, 'badge', { unread: 2 });
    await new Promise((resolve) => setTimeout(resolve, 6_000));

    expect(swept).toEqual({ op: 'event', topic, event: 'badge', payload: { unread: 1 } });
    expect(eventsOf(his).map((frame) => (frame.op === 'event' ? frame.payload : null))).toEqual([{ unread: 1 }, { unread: 2 }]);
  }, 20_000);

  it('delivers a chat\'s events to both members and keeps an outsider out', async () => {
    const topic = `chat:${chatId}:messages`;
    const [hers, his, theirs] = await Promise.all([signedIn(alice), signedIn(bob), signedIn(outsider)]);

    const answers = await Promise.all([subscribe(hers, topic), subscribe(his, topic), subscribe(theirs, topic)]);
    await databaseSends(topic, 'INSERT', { message_id: 'm1' });
    await Promise.all([hers.next((frame) => frame.op === 'event'), his.next((frame) => frame.op === 'event')]);
    await quiet();

    expect(answers.map((answer) => answer.op)).toEqual(['ok', 'ok', 'error']);
    expect(eventsOf(theirs)).toEqual([]);
  });

  it('carries typing from one member of a chat to the other, and refuses a forged message event', async () => {
    const typing = `chat:${chatId}:typing`;
    const messages = `chat:${chatId}:messages`;
    const [hers, his] = await Promise.all([signedIn(alice), signedIn(bob)]);
    await Promise.all([subscribe(hers, typing), subscribe(his, typing), subscribe(hers, messages), subscribe(his, messages)]);

    hers.say({ op: 'broadcast', topic: typing, event: 'typing', payload: { userId: alice.userId } });
    const received = await his.next((frame) => frame.op === 'event');
    // Messages are sent by the database only: a member may not send on that topic.
    hers.say({ op: 'broadcast', topic: messages, event: 'INSERT', payload: { body: 'forged' } });
    const refusal = await hers.next((frame) => frame.op === 'error');
    await quiet();

    expect(received).toEqual({ op: 'event', topic: typing, event: 'typing', payload: { userId: alice.userId } });
    expect(refusal).toEqual({ op: 'error', code: 'forbidden' });
    expect(eventsOf(his)).toHaveLength(1);
    expect(eventsOf(hers)).toEqual([]);
  });

  it('shows who is online to members who show their own status', async () => {
    const [hers, his] = await Promise.all([signedIn(alice), signedIn(bob)]);
    await subscribe(hers, 'presence:online', 'presence');
    hers.say({ op: 'track', topic: 'presence:online', meta: {} });

    await subscribe(his, 'presence:online', 'presence');
    const state = await his.next((frame) => frame.op === 'presence_state');
    hers.close();
    const diff = await his.next((frame) => frame.op === 'presence_diff' && frame.leaves.length > 0);

    expect(state).toEqual({ op: 'presence_state', topic: 'presence:online', members: [{ key: alice.userId, meta: {} }] });
    expect(diff).toMatchObject({ leaves: [{ key: alice.userId }] });
  });

  it('closes a connection whose token is not valid, and one that subscribes before signing in', async () => {
    const forged = await connect();
    const early = await connect();

    forged.say({ op: 'auth', token: await gateway.issuer.sign(alice.userId, { foreignKey: true }) });
    early.say({ op: 'subscribe', ref: 'r', topic: 'feed:public', extension: 'broadcast' });

    expect(await forged.closed).toBe(REALTIME_CLOSE.unauthenticated);
    expect(await early.closed).toBe(REALTIME_CLOSE.unauthenticated);
    expect([...forged.frames, ...early.frames]).toEqual([]);
  });
});
