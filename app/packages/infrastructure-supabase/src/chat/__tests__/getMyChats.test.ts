import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { getMyChats } from '../getMyChats';

const ROW = {
  chat_id: 'c_1',
  kind: 'direct',
  anchor_post_id: 'p_1',
  last_message_at: '2026-05-16T12:00:00.000Z',
  counterpart_id: 'u_other',
  counterpart_display_name: 'Dana',
  counterpart_avatar_url: 'https://x/a.png',
  counterpart_share_handle: 'dana',
  counterpart_last_read_at: '2026-05-16T11:00:00.000Z',
  last_message_id: 'm_1',
  last_message_kind: 'user',
  last_message_sender_id: 'u_other',
  last_message_preview: 'see you',
  unread_count: 2,
};

const inbox = (data: unknown, error: { code?: string; message: string } | null = null) =>
  createFakeClient({ rpc: { chat_inbox_page: { data, error } } });

describe('getMyChats', () => {
  it('reads one chat_inbox_page call of 50 rows', async () => {
    const { client, calls } = inbox([ROW]);

    await getMyChats(client, 'u_me');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'chat_inbox_page', args: { p_limit: 50 } });
  });

  it('maps a row to the chat, the counterpart, the preview message and the unread count', async () => {
    const [chat] = await getMyChats(inbox([ROW]).client, 'u_me');

    expect(chat).toMatchObject({
      chatId: 'c_1',
      participantIds: ['u_me', 'u_other'],
      anchorPostId: 'p_1',
      isSupportThread: false,
      lastMessageAt: '2026-05-16T12:00:00.000Z',
      unreadCount: 2,
      otherParticipant: {
        userId: 'u_other',
        displayName: 'Dana',
        avatarUrl: 'https://x/a.png',
        shareHandle: 'dana',
        isDeleted: false,
      },
      lastMessage: { messageId: 'm_1', senderId: 'u_other', kind: 'user', body: 'see you', createdAt: '2026-05-16T12:00:00.000Z' },
    });
  });

  it('keeps the order the server returned (newest message first)', async () => {
    const rows = [
      { ...ROW, chat_id: 'c_new', last_message_at: '2026-05-16T13:00:00.000Z' },
      { ...ROW, chat_id: 'c_old', last_message_at: '2026-05-16T10:00:00.000Z' },
    ];

    const chats = await getMyChats(inbox(rows).client, 'u_me');

    expect(chats.map((c) => c.chatId)).toEqual(['c_new', 'c_old']);
  });

  it('shows a counterpart that is gone (null id on a direct chat) as a deleted user', async () => {
    const gone = { ...ROW, counterpart_id: null, counterpart_display_name: null, counterpart_avatar_url: null, counterpart_share_handle: null };

    const [chat] = await getMyChats(inbox([gone]).client, 'u_me');

    expect(chat?.otherParticipant).toMatchObject({ userId: null, displayName: null, isDeleted: true });
  });

  it("flags the member's support thread and does not show it as a deleted user", async () => {
    const support = { ...ROW, kind: 'support', counterpart_id: null, counterpart_display_name: null, anchor_post_id: null };

    const [chat] = await getMyChats(inbox([support]).client, 'u_me');

    expect(chat?.isSupportThread).toBe(true);
    expect(chat?.otherParticipant.isDeleted).toBe(false);
  });

  it('has no preview message when the page carries none', async () => {
    const [chat] = await getMyChats(inbox([{ ...ROW, last_message_id: null }]).client, 'u_me');

    expect(chat?.lastMessage).toBeNull();
  });

  it('maps a message without a text preview to an empty body (system and media-only messages)', async () => {
    const [chat] = await getMyChats(inbox([{ ...ROW, last_message_kind: 'system', last_message_sender_id: null, last_message_preview: null }]).client, 'u_me');

    expect(chat?.lastMessage).toMatchObject({ kind: 'system', senderId: null, body: '' });
  });

  it('returns an empty inbox for an empty page', async () => {
    expect(await getMyChats(inbox([]).client, 'u_me')).toEqual([]);
    expect(await getMyChats(inbox(null).client, 'u_me')).toEqual([]);
  });

  it('maps a stable refusal to a ChatError', async () => {
    const client = inbox(null, { code: '42501', message: 'unauthenticated' }).client;

    await expect(getMyChats(client, 'u_me')).rejects.toMatchObject({ code: 'chat_forbidden' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const client = inbox(null, { code: 'PGRST202', message: 'not in the schema cache' }).client;

    await expect(getMyChats(client, 'u_me')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
