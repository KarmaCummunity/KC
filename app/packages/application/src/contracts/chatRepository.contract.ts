// IChatRepository contract (G39) — the 1-on-1 chat behaviour every implementation
// must honour, seen from the participants' side. Mapped to FR-CHAT-001 (inbox),
// FR-CHAT-002 (messages), FR-CHAT-003 (participants only), FR-CHAT-004 (one thread
// per pair), FR-CHAT-012 (unread badge) and FR-CHAT-016 (personal inbox hide).
//
// Chat is two-sided by nature, so every case seeds fresh actors of its own and is
// order-independent. The support thread (FR-CHAT-007) needs a super admin on the
// stack and stays in its own adapter tests.

import type { Message } from '@kc/domain';
import type { IChatRepository } from '../ports/IChatRepository';
import type { ContractCase } from './types';
import { assertEqual, assertRejectsWithCode, assertSameList, assertTrue } from './assert';

/** messages_user_shape / messages_body_check: a user message is 1–2000 characters. */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

export interface ChatActor {
  readonly userId: string;
  readonly displayName: string;
  /** Chat repository acting as `userId` (for the Supabase adapter: that user's signed-in client). */
  readonly chats: IChatRepository;
}

export interface ChatContractContext {
  /** A new active member with no chats. */
  newActor(): Promise<ChatActor>;
}

type Ctx = ChatContractContext;

/** The chat between two actors, opened by the first. */
async function openChat(from: ChatActor, to: ChatActor): Promise<string> {
  return (await from.chats.findOrCreateChat(from.userId, to.userId)).chatId;
}

async function inboxIds(actor: ChatActor): Promise<string[]> {
  return (await actor.chats.getMyChats(actor.userId)).map((c) => c.chatId);
}

const onePairOneThread: ContractCase<Ctx> = {
  name: 'findOrCreateChat: one thread per pair, whichever side opens it (FR-CHAT-004)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chat = await a.chats.findOrCreateChat(a.userId, b.userId);
    assertEqual((await b.chats.findOrCreateChat(b.userId, a.userId)).chatId, chat.chatId, 'chat opened by the other side');
    assertEqual((await a.chats.findOrCreateChat(a.userId, b.userId)).chatId, chat.chatId, 'chat reopened by the opener');
    const byId = (left: string | null, right: string | null) => (left ?? '').localeCompare(right ?? '');
    assertSameList([...chat.participantIds].sort(byId), [a.userId, b.userId].sort(byId), 'participants');
    assertEqual(chat.isSupportThread, false, 'a member-to-member chat is not the support thread');
    assertEqual(chat.anchorPostId, null, 'a chat opened without an anchor has no post anchor');
  },
};

const unknownCounterpartRefused: ContractCase<Ctx> = {
  name: 'findOrCreateChat: refused for a counterpart that does not exist (send_to_deleted_user)',
  async run(ctx) {
    const a = await ctx.newActor();
    await assertRejectsWithCode(
      a.chats.findOrCreateChat(a.userId, crypto.randomUUID()),
      'send_to_deleted_user',
      'chat with an unknown user id',
    );
  },
};

const messagesNewestFirstPaged: ContractCase<Ctx> = {
  name: 'sendMessage / getMessages: both sides read the thread newest first, paged by beforeCreatedAt (FR-CHAT-002)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chatId = await openChat(a, b);
    const sent: Message[] = [];
    for (const body of ['first', 'second', 'third']) sent.push(await a.chats.sendMessage(chatId, a.userId, body));
    const [first, second, third] = sent;
    assertEqual(third?.senderId, a.userId, 'sent message carries its sender');
    assertEqual(third?.kind, 'user', 'sent message is a user message');
    assertEqual(third?.body, 'third', 'sent message carries its body');
    const page1 = await b.chats.getMessages(chatId, 2);
    assertSameList(page1.map((m) => m.messageId), [third!.messageId, second!.messageId], 'first page, read by the recipient');
    const page2 = await b.chats.getMessages(chatId, 2, second!.createdAt);
    assertSameList(page2.map((m) => m.messageId), [first!.messageId], 'page before the second message');
  },
};

const bodyLengthBounded: ContractCase<Ctx> = {
  name: `sendMessage: up to ${CHAT_MESSAGE_MAX_LENGTH} characters; a longer body is refused (message_too_long)`,
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chatId = await openChat(a, b);
    const longest = await a.chats.sendMessage(chatId, a.userId, 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH));
    assertEqual(longest.body.length, CHAT_MESSAGE_MAX_LENGTH, 'body at the limit is stored whole');
    await assertRejectsWithCode(
      a.chats.sendMessage(chatId, a.userId, 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1)),
      'message_too_long',
      'body one character over the limit',
    );
  },
};

const unreadUntilMarkedRead: ContractCase<Ctx> = {
  name: "unread: the counterpart's messages count until markRead; my own never do (FR-CHAT-012)",
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chatId = await openChat(a, b);
    await a.chats.sendMessage(chatId, a.userId, 'hello');
    const latest = await a.chats.sendMessage(chatId, a.userId, 'are you there?');
    assertEqual(await b.chats.getUnreadTotal(b.userId), 2, "recipient's unread total");
    assertEqual(await a.chats.getUnreadTotal(a.userId), 0, "sender's unread total");
    const [row] = await b.chats.getMyChats(b.userId);
    assertEqual(row?.unreadCount, 2, "recipient's inbox row unread count");
    assertEqual(row?.lastMessage?.messageId, latest.messageId, "recipient's inbox row preview is the latest message");
    await b.chats.markRead(chatId, b.userId);
    assertEqual(await b.chats.getUnreadTotal(b.userId), 0, "recipient's unread total after markRead");
    assertEqual((await b.chats.getMyChats(b.userId))[0]?.unreadCount, 0, "recipient's row after markRead");
  },
};

const inboxPerCounterpart: ContractCase<Ctx> = {
  name: 'getMyChats: one row per counterpart with their profile, latest activity first; others see none of it (FR-CHAT-001)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const c = await ctx.newActor();
    const outsider = await ctx.newActor();
    const withB = await openChat(a, b);
    const withC = await openChat(a, c);
    await a.chats.sendMessage(withB, a.userId, 'to b');
    await a.chats.sendMessage(withC, a.userId, 'to c');
    const inbox = await a.chats.getMyChats(a.userId);
    assertSameList(inbox.map((r) => r.chatId), [withC, withB], "opener's inbox, latest activity first");
    assertEqual(inbox[0]?.otherParticipant.userId, c.userId, 'row names its counterpart');
    assertEqual(inbox[0]?.otherParticipant.displayName, c.displayName, "row carries the counterpart's display name");
    assertEqual(inbox[0]?.otherParticipant.isDeleted, false, 'an active counterpart is not deleted');
    assertSameList(await inboxIds(b), [withB], "counterpart's inbox");
    assertSameList(await inboxIds(outsider), [], "a non-participant's inbox");
  },
};

const participantsOnly: ContractCase<Ctx> = {
  name: 'a non-participant can neither read nor write the chat (FR-CHAT-003)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const outsider = await ctx.newActor();
    const chatId = await openChat(a, b);
    await a.chats.sendMessage(chatId, a.userId, 'private');
    assertEqual(await outsider.chats.findById(chatId), null, 'findById by a non-participant');
    assertSameList(await outsider.chats.getMessages(chatId, 10), [], 'getMessages by a non-participant');
    await assertRejectsWithCode(
      outsider.chats.sendMessage(chatId, outsider.userId, 'let me in'),
      'chat_forbidden',
      'sendMessage by a non-participant',
    );
    assertEqual((await b.chats.findById(chatId))?.chatId, chatId, 'findById by a participant');
  },
};

const hideIsPersonal: ContractCase<Ctx> = {
  name: 'hideChatFromInbox: hides for me only, drops it from my unread, and a new message brings it back (FR-CHAT-016 AC5, AC6)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chatId = await openChat(a, b);
    await a.chats.sendMessage(chatId, a.userId, 'one');
    await b.chats.hideChatFromInbox(chatId);
    assertSameList(await inboxIds(b), [], "hider's inbox");
    assertEqual(await b.chats.getUnreadTotal(b.userId), 0, "hider's unread total excludes the hidden chat");
    assertSameList(await inboxIds(a), [chatId], "counterpart's inbox keeps the chat");
    await a.chats.sendMessage(chatId, a.userId, 'two');
    assertSameList(await inboxIds(b), [chatId], "hider's inbox after a new message");
    assertEqual(await b.chats.getUnreadTotal(b.userId), 2, "hider's unread total after the chat reappears");
  },
};

const newThreadAfterHide: ContractCase<Ctx> = {
  name: 'findOrCreateChat after a hide opens a new, empty thread with the same counterpart (FR-CHAT-016 AC3)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const hidden = await openChat(a, b);
    await a.chats.sendMessage(hidden, a.userId, 'before the hide');
    await a.chats.hideChatFromInbox(hidden);
    const fresh = await openChat(a, b);
    assertTrue(fresh !== hidden, 'a new chat id after the hide');
    assertSameList(await a.chats.getMessages(fresh, 10), [], 'the new thread starts empty');
    // AC4: the thread with the latest activity wins, so both sides now meet in the new one.
    assertEqual((await b.chats.findOrCreateChat(b.userId, a.userId)).chatId, fresh, 'the counterpart lands in the new thread too');
    assertSameList(await inboxIds(b), [fresh], "counterpart's inbox shows one row for the pair");
  },
};

const firstMessageDetected: ContractCase<Ctx> = {
  name: 'hasSentAnyMessage: false until the member sends a message (FR-NOTIF-015 AC1)',
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chatId = await openChat(a, b);
    assertEqual(await a.chats.hasSentAnyMessage(a.userId), false, 'before any message');
    await a.chats.sendMessage(chatId, a.userId, 'hi');
    assertEqual(await a.chats.hasSentAnyMessage(a.userId), true, "sender's flag after a message");
    assertEqual(await b.chats.hasSentAnyMessage(b.userId), false, "recipient's flag is unaffected");
  },
};

const counterpartProfile: ContractCase<Ctx> = {
  name: "getCounterpart: the other participant's profile, from either side",
  async run(ctx) {
    const a = await ctx.newActor();
    const b = await ctx.newActor();
    const chat = await a.chats.findOrCreateChat(a.userId, b.userId);
    const seenByA = await a.chats.getCounterpart(chat, a.userId);
    assertEqual(seenByA.userId, b.userId, "A's counterpart");
    assertEqual(seenByA.displayName, b.displayName, "A's counterpart display name");
    assertEqual(seenByA.isDeleted, false, "A's counterpart is active");
    assertEqual((await b.chats.getCounterpart(chat, b.userId)).userId, a.userId, "B's counterpart");
  },
};

/** Every case an IChatRepository implementation must pass. */
export function chatRepositoryContract(): ContractCase<ChatContractContext>[] {
  return [
    onePairOneThread,
    unknownCounterpartRefused,
    messagesNewestFirstPaged,
    bodyLengthBounded,
    unreadUntilMarkedRead,
    inboxPerCounterpart,
    participantsOnly,
    hideIsPersonal,
    newThreadAfterHide,
    firstMessageDetected,
    counterpartProfile,
  ];
}
