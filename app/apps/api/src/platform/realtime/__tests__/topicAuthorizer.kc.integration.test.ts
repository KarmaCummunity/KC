import { SupabaseChatRepository } from '@kc/infrastructure-supabase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KcTestDatabase, type TestMember } from '../../../__tests__/support/kcDatabase';
import { IdentityDatabase } from '../../database/identityDatabase';
import { MAX_TOPIC_LENGTH, TopicAuthorizer } from '../topicAuthorizer';

const OPEN = { receive: true, send: true };
const RECEIVE_ONLY = { receive: true, send: false };
const CLOSED = { receive: false, send: false };

/**
 * Who may join which realtime topic, decided by the real policies on
 * `realtime.messages` (ADR-011 section 2). Every row of ADR-003's table that
 * a policy guards has a case here, for the member it is for and for another.
 */
describe('TopicAuthorizer on the KC policies', () => {
  const database = new KcTestDatabase();
  const authorizer = new TopicAuthorizer(new IdentityDatabase(database.admin));
  let alice: TestMember;
  let bob: TestMember;
  let outsider: TestMember;
  /** A direct chat between Alice and Bob. */
  let chatId: string;

  const storedMessages = async () => Number((await database.admin.query<{ count: string }>('select count(*) from realtime.messages')).rows[0]?.count);

  beforeAll(async () => {
    [alice, bob, outsider] = await Promise.all([database.newMember(), database.newMember(), database.newMember()]);
    const chats = new SupabaseChatRepository(database.clientFor(alice.caller));
    chatId = (await chats.findOrCreateChat(alice.userId, bob.userId)).chatId;
  });

  afterAll(async () => {
    await database.close();
  });

  it('opens a member\'s own topics to that member only, to receive and never to send', async () => {
    for (const facet of ['notifications', 'chats', 'stats']) {
      const topic = `user:${alice.userId}:${facet}`;

      expect(await authorizer.accessOf(alice.caller, topic, 'broadcast'), topic).toEqual(RECEIVE_ONLY);
      expect(await authorizer.accessOf(bob.caller, topic, 'broadcast'), topic).toEqual(CLOSED);
    }
  });

  it('opens the public feed topic to every member, to receive only', async () => {
    expect(await authorizer.accessOf(alice.caller, 'feed:public', 'broadcast')).toEqual(RECEIVE_ONLY);
    // The feed topic carries broadcasts; nobody is "present" on it.
    expect(await authorizer.accessOf(alice.caller, 'feed:public', 'presence')).toEqual(CLOSED);
  });

  it('opens a chat\'s topics to its two members and to nobody else', async () => {
    const messages = `chat:${chatId}:messages`;
    const typing = `chat:${chatId}:typing`;

    // Messages are sent by the database, never by a member; typing is sent by members.
    expect(await authorizer.accessOf(alice.caller, messages, 'broadcast')).toEqual(RECEIVE_ONLY);
    expect(await authorizer.accessOf(bob.caller, typing, 'broadcast')).toEqual(OPEN);
    expect(await authorizer.accessOf(alice.caller, `chat:${chatId}:presence`, 'presence')).toEqual(OPEN);
    for (const topic of [messages, typing]) {
      expect(await authorizer.accessOf(outsider.caller, topic, 'broadcast'), topic).toEqual(CLOSED);
    }
  });

  it('opens online presence only to a member who shows their own active status', async () => {
    const before = await authorizer.accessOf(alice.caller, 'presence:online', 'presence');
    await database.admin.query('update public.user_private set show_active_status = false where user_id = $1', [alice.userId]);
    const hidden = await authorizer.accessOf(alice.caller, 'presence:online', 'presence');
    await database.admin.query('update public.user_private set show_active_status = true where user_id = $1', [alice.userId]);

    expect(before).toEqual(OPEN);
    // Reciprocal: a member who hides their status neither shows it nor sees others'.
    expect(hidden).toEqual(CLOSED);
    // The presence topic is not a broadcast topic.
    expect(await authorizer.accessOf(alice.caller, 'presence:online', 'broadcast')).toEqual(CLOSED);
  });

  it('keeps a topic no policy names closed, however it is written', async () => {
    const topics = ['admin:all', 'user:not-a-uuid:notifications', `post:${chatId}:engagement`, 'chat:%:messages', '', 'x'.repeat(MAX_TOPIC_LENGTH + 1)];

    for (const topic of topics) {
      expect(await authorizer.accessOf(alice.caller, topic, 'broadcast'), topic).toEqual(CLOSED);
    }
  });

  it('leaves no trace: the probe rows are never stored', async () => {
    const before = await storedMessages();

    await authorizer.accessOf(alice.caller, `chat:${chatId}:typing`, 'broadcast');
    await authorizer.accessOf(outsider.caller, `chat:${chatId}:typing`, 'broadcast');

    expect(await storedMessages()).toBe(before);
  });
});
