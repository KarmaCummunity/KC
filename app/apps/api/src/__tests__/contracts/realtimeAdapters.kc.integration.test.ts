import 'reflect-metadata';
import { newPostInput } from '@kc/application';
import type { Address, Message } from '@kc/domain';
import { type ApiRealtimeHost, createApiRealtimeHost, REALTIME_PATH, RealtimeSocket } from '@kc/infrastructure-api';
import {
  SupabaseChatRealtime,
  SupabaseChatRepository,
  SupabaseChatV2Realtime,
  SupabaseFeedRealtime,
  SupabaseOnlinePresence,
  SupabasePostRepository,
} from '@kc/infrastructure-supabase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

const WAIT_MS = 8_000;

/** Resolves when `check` returns a value, polling briefly; rejects with `what` after the wait. */
async function eventually<T>(what: string, check: () => T | undefined | null | false): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * The app's realtime adapters, exactly as they are, on KC's own gateway
 * (ADR-011 section 5): the channel host replaces the Supabase client under
 * them, and the events come from the real database triggers.
 */
describe.skipIf(!KC_DATABASE_URL)('Realtime adapters on the gateway', () => {
  const database = new KcTestDatabase();
  const cleanups: Array<() => void> = [];
  let gateway: KcGateway;
  let url: string;
  let alice: TestMember;
  let bob: TestMember;
  let chatId: string;

  /** The realtime host of a member's device: one socket, signed in as that member. */
  const hostOf = (member: TestMember): ApiRealtimeHost => createApiRealtimeHost(new RealtimeSocket({ url, getAccessToken: () => gateway.issuer.sign(member.userId) }));
  /** The adapters take the Supabase client; the host stands where the client's realtime members are. */
  const asClient = <Client>(host: ApiRealtimeHost) => host as unknown as Client;
  const later = (cleanup: () => void) => void cleanups.push(cleanup);
  /** The adapters give no "joined" callback, so a test that must not send too early waits for the join to be answered. */
  const joined = () => new Promise((resolve) => setTimeout(resolve, 500));

  beforeAll(async () => {
    gateway = await startKcGateway();
    url = `${(await gateway.listen()).replace('http', 'ws')}${REALTIME_PATH}`;
    [alice, bob] = await Promise.all([database.newMember(), database.newMember()]);
    chatId = (await new SupabaseChatRepository(database.clientFor(alice.caller)).findOrCreateChat(alice.userId, bob.userId)).chatId;
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  afterAll(async () => {
    await gateway?.app.close();
    await database.close();
  });

  it('delivers a chat message to the other member the moment it is sent', async () => {
    const received: Message[] = [];
    const realtime = new SupabaseChatRealtime(asClient(hostOf(bob)));
    later(realtime.subscribeToChat(chatId, { onMessage: (message) => received.push(message), onReadMarker: () => undefined, onError: () => undefined }));
    await joined();

    const sent = await new SupabaseChatRepository(database.clientFor(alice.caller)).sendMessage(chatId, alice.userId, 'On my way');
    const message = await eventually('the message', () => received[0]);

    expect(message).toMatchObject({ messageId: sent.messageId, chatId, senderId: alice.userId, body: 'On my way' });
  });

  it('shows one member typing to the other, and not to themselves', async () => {
    const seenByBob: Array<{ userId: string; typing: boolean }> = [];
    const seenByAlice: unknown[] = [];
    const hers = new SupabaseChatV2Realtime(asClient(hostOf(alice))).subscribeTyping(chatId, alice.userId, { onPeerTyping: (peer) => seenByAlice.push(peer) });
    const his = new SupabaseChatV2Realtime(asClient(hostOf(bob))).subscribeTyping(chatId, bob.userId, { onPeerTyping: (peer) => seenByBob.push(peer) });
    later(() => hers.unsubscribe());
    later(() => his.unsubscribe());
    await joined();

    hers.sendTyping(true);
    const peer = await eventually('the typing event', () => seenByBob[0]);

    expect(peer).toEqual({ userId: alice.userId, typing: true });
    expect(seenByAlice).toEqual([]);
  });

  it('shows who is online, and that they left', async () => {
    const hers = new SupabaseOnlinePresence(asClient(hostOf(alice)));
    const his = new SupabaseOnlinePresence(asClient(hostOf(bob)));
    later(() => hers.stop());
    later(() => his.stop());

    hers.start(alice.userId);
    his.start(bob.userId);
    await eventually('both members online', () => his.isOnline(alice.userId) && hers.isOnline(bob.userId));
    hers.stop();
    await eventually('the leave', () => !his.isOnline(alice.userId));

    expect(his.isOnline(bob.userId)).toBe(true);
  });

  it('signals a new public post to members watching the feed', async () => {
    const signals: Array<{ postId: string | null; ownerId: string | null }> = [];
    later(new SupabaseFeedRealtime(asClient(hostOf(bob))).subscribeToPublicInserts({ onNewPublicPost: (signal) => signals.push(signal) }));
    await joined();
    const city = await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1');
    const address: Address = { city: city.rows[0]?.city_id ?? '', cityName: city.rows[0]?.name_he ?? '', street: 'Contract St', streetNumber: '1' };

    const post = await new SupabasePostRepository(database.clientFor(alice.caller)).create(newPostInput(alice.userId, address));
    const signal = await eventually('the feed signal', () => signals.find((candidate) => candidate.postId === post.postId));

    // Ids only: the watcher re-reads the feed under their own rights.
    expect(signal).toEqual({ postId: post.postId, ownerId: alice.userId });
  });
});
