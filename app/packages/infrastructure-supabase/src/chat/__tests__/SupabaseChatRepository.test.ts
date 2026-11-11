import { describe, it, expect } from 'vitest';
import { BackendUnavailableError, type Chat } from '@kc/domain';
import { createFakeClient, callsTo, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { SupabaseChatRepository } from '../SupabaseChatRepository';

const MESSAGE_ROW = {
  id: 'm_1',
  chat_id: 'c_1',
  sender_id: 'u_me',
  kind: 'user',
  body: 'hello',
  system_payload: null,
  media_payload: null,
  source_language: null,
  created_at: '2026-05-16T12:00:00.000Z',
};

const CHAT_ROW = {
  id: 'c_1',
  kind: 'direct',
  direct_user_a: 'u_me',
  direct_user_b: 'u_other',
  support_user_id: null,
  anchor_post_id: null,
  last_message_at: '2026-05-16T12:00:00.000Z',
  created_at: '2026-05-16T11:00:00.000Z',
};

const repo = (config: FakeClientConfig) => {
  const fake = createFakeClient(config);
  return { ...fake, repo: new SupabaseChatRepository(fake.client) };
};

const direct: Chat = {
  chatId: 'c_1',
  participantIds: ['u_me', 'u_other'],
  anchorPostId: null,
  isSupportThread: false,
  lastMessageAt: null,
  createdAt: '2026-05-16T11:00:00.000Z',
};

describe('SupabaseChatRepository.findById', () => {
  it('selects the chat by id and maps it', async () => {
    const { repo: r, calls } = repo({ tables: { chats: { data: CHAT_ROW, error: null } } });

    const chat = await r.findById('c_1');

    expect(calls[0]).toMatchObject({ kind: 'select', table: 'chats', single: true });
    expect(calls[0]?.filters).toContainEqual(['eq', 'id', 'c_1']);
    expect(chat).toMatchObject({ chatId: 'c_1', participantIds: ['u_me', 'u_other'] });
  });

  it('is null for a chat the caller cannot see', async () => {
    expect(await repo({ tables: { chats: { data: null, error: null } } }).repo.findById('c_x')).toBeNull();
  });

  it('reports a missing table as BackendUnavailableError', async () => {
    const { repo: r } = repo({ tables: { chats: { data: null, error: { code: 'PGRST205', message: 'not in the schema cache' } } } });

    await expect(r.findById('c_1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseChatRepository.findOrCreateChat / hideChatFromInbox', () => {
  it('opens the direct chat through open_direct_chat and ignores preferNewThread', async () => {
    const { repo: r, calls } = repo({ rpc: { open_direct_chat: { data: CHAT_ROW, error: null } } });

    const chat = await r.findOrCreateChat('u_me', 'u_other', { postId: 'p_1' }, { preferNewThread: true });

    expect(calls[0]).toMatchObject({ fn: 'open_direct_chat', args: { p_user_id: 'u_other', p_anchor_post_id: 'p_1' } });
    expect(chat.chatId).toBe('c_1');
  });

  it('hides a chat through hide_chat', async () => {
    const { repo: r, calls } = repo({ rpc: { hide_chat: { data: null, error: null } } });

    await r.hideChatFromInbox('c_1');

    expect(calls[0]).toMatchObject({ fn: 'hide_chat', args: { p_chat_id: 'c_1' } });
  });
});

describe('SupabaseChatRepository.getMessages', () => {
  const markers = { data: [{ user_id: 'u_me', last_read_at: '2026-05-16T12:00:00.000Z' }, { user_id: 'u_other', last_read_at: '2026-05-16T11:00:00.000Z' }], error: null };

  it('pages with chat_messages_page and loads the read markers of the chat', async () => {
    const { repo: r, calls } = repo({
      rpc: { chat_messages_page: { data: [MESSAGE_ROW], error: null } },
      tables: { chat_members: markers },
    });

    await r.getMessages('c_1', 30, '2026-05-16T13:00:00.000Z');

    expect(callsTo(calls, 'chat_messages_page')[0]?.args).toEqual({ p_chat_id: 'c_1', p_limit: 30, p_before: '2026-05-16T13:00:00.000Z' });
    const members = callsTo(calls, 'chat_members')[0];
    expect(members?.columns).toBe('user_id, last_read_at');
    expect(members?.filters).toContainEqual(['eq', 'chat_id', 'c_1']);
  });

  it('marks my message read once the other member passed it, and delivered before that', async () => {
    const mine = { ...MESSAGE_ROW, id: 'm_old', created_at: '2026-05-16T10:00:00.000Z' };
    const newer = { ...MESSAGE_ROW, id: 'm_new', created_at: '2026-05-16T12:00:00.000Z' };
    const { repo: r } = repo({
      rpc: { chat_messages_page: { data: [newer, mine], error: null } },
      tables: { chat_members: markers },
    });

    const [latest, old] = await r.getMessages('c_1', 30);

    expect(latest).toMatchObject({ messageId: 'm_new', status: 'delivered', readAt: null });
    expect(old).toMatchObject({ messageId: 'm_old', status: 'read', readAt: '2026-05-16T11:00:00.000Z' });
  });

  it('reads a chat the caller is not a member of as empty (FR-CHAT-003)', async () => {
    const { repo: r } = repo({
      rpc: { chat_messages_page: { data: null, error: { code: 'P0001', message: 'chat_not_found' } } },
      tables: { chat_members: markers },
    });

    await expect(r.getMessages('c_1', 30)).resolves.toEqual([]);
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { repo: r } = repo({
      rpc: { chat_messages_page: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
      tables: { chat_members: markers },
    });

    await expect(r.getMessages('c_1', 30)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseChatRepository.sendMessage', () => {
  it('calls send_message with the client message id (idempotent retry) and maps the row', async () => {
    const { repo: r, calls } = repo({ rpc: { send_message: { data: MESSAGE_ROW, error: null } } });

    const message = await r.sendMessage('c_1', 'u_me', 'hello', 'client-1');

    expect(calls[0]).toMatchObject({ fn: 'send_message', args: { p_chat_id: 'c_1', p_body: 'hello', p_message_id: 'client-1' } });
    expect(message).toMatchObject({ messageId: 'm_1', senderId: 'u_me', body: 'hello', status: 'delivered' });
  });

  it.each([
    ['rate_limited', 'rate_limited'],
    ['blocked_relationship', 'blocked_relationship'],
    ['chat_not_found', 'chat_forbidden'],
    ['message_body_invalid', 'message_too_long'],
  ])('maps the refusal %s to ChatError %s', async (reason, code) => {
    const { repo: r } = repo({ rpc: { send_message: { data: null, error: { code: 'P0001', message: reason } } } });

    await expect(r.sendMessage('c_1', 'u_me', 'hello')).rejects.toMatchObject({ code });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { repo: r } = repo({ rpc: { send_message: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } } });

    await expect(r.sendMessage('c_1', 'u_me', 'hello')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseChatRepository read state', () => {
  it('markRead calls mark_chat_read', async () => {
    const { repo: r, calls } = repo({ rpc: { mark_chat_read: { data: null, error: null } } });

    await r.markRead('c_1', 'u_me');

    expect(calls[0]).toMatchObject({ fn: 'mark_chat_read', args: { p_chat_id: 'c_1' } });
  });

  it('getUnreadTotal reads chat_unread_total as a number', async () => {
    const { repo: r, calls } = repo({ rpc: { chat_unread_total: { data: '7', error: null } } });

    expect(await r.getUnreadTotal('u_me')).toBe(7);
    expect(calls[0]).toMatchObject({ fn: 'chat_unread_total' });
  });
});

describe('SupabaseChatRepository support thread', () => {
  const SUPPORT_ROW = { ...CHAT_ROW, kind: 'support', direct_user_a: null, direct_user_b: null, support_user_id: 'u_me' };

  it('getOrCreateSupportThread opens the thread', async () => {
    const { repo: r } = repo({ rpc: { open_support_thread: { data: SUPPORT_ROW, error: null } } });

    expect(await r.getOrCreateSupportThread('u_me')).toMatchObject({ isSupportThread: true });
  });

  it('submitSupportIssue opens the thread, then sends the issue into it', async () => {
    const { repo: r, calls } = repo({
      rpc: { open_support_thread: { data: SUPPORT_ROW, error: null }, send_message: { data: MESSAGE_ROW, error: null } },
    });

    const chat = await r.submitSupportIssue('Bug', 'The map does not load for me');

    expect(calls.map((c) => c.fn)).toEqual(['open_support_thread', 'send_message']);
    expect(calls[1]?.args).toEqual({ p_chat_id: 'c_1', p_body: 'Bug\n\nThe map does not load for me' });
    expect(chat.isSupportThread).toBe(true);
  });
});

describe('SupabaseChatRepository.hasSentAnyMessage', () => {
  it('is true when a user message of the caller exists', async () => {
    const { repo: r, calls } = repo({ tables: { messages: { data: [{ id: 'm_1' }], error: null } } });

    expect(await r.hasSentAnyMessage('u_me')).toBe(true);
    expect(calls[0]?.filters).toEqual(expect.arrayContaining([['eq', 'sender_id', 'u_me'], ['eq', 'kind', 'user'], ['limit', 1]]));
  });

  it('is false when the caller never wrote one', async () => {
    expect(await repo({ tables: { messages: { data: [], error: null } } }).repo.hasSentAnyMessage('u_me')).toBe(false);
  });
});

describe('SupabaseChatRepository.getMyChats', () => {
  it('delegates to chat_inbox_page', async () => {
    const { repo: r, calls } = repo({ rpc: { chat_inbox_page: { data: [], error: null } } });

    expect(await r.getMyChats('u_me')).toEqual([]);
    expect(calls[0]).toMatchObject({ fn: 'chat_inbox_page' });
  });
});

describe('SupabaseChatRepository.getCounterpart', () => {
  const USER_ROW = { id: 'u_other', display_name: 'Dana', avatar_url: null, share_handle: 'dana', verification_level: 2 };

  it('reads the other member of a direct chat from users', async () => {
    const { repo: r, calls } = repo({ tables: { users: { data: USER_ROW, error: null } } });

    const counterpart = await r.getCounterpart(direct, 'u_me');

    expect(calls[0]?.filters).toContainEqual(['eq', 'id', 'u_other']);
    expect(counterpart).toEqual({
      userId: 'u_other',
      displayName: 'Dana',
      avatarUrl: null,
      shareHandle: 'dana',
      isDeleted: false,
      verificationLevel: 2,
    });
  });

  it('works from the other side of the pair', async () => {
    const { repo: r, calls } = repo({ tables: { users: { data: { ...USER_ROW, id: 'u_me' }, error: null } } });

    await r.getCounterpart(direct, 'u_other');

    expect(calls[0]?.filters).toContainEqual(['eq', 'id', 'u_me']);
  });

  it('is the deleted-user placeholder when the member is gone (null participant)', async () => {
    const { repo: r, calls } = repo({});

    const counterpart = await r.getCounterpart({ ...direct, participantIds: ['u_me', null] }, 'u_me');

    expect(counterpart).toMatchObject({ userId: null, displayName: null, isDeleted: true });
    expect(calls).toHaveLength(0);
  });

  it('is the deleted-user placeholder when the profile is not visible', async () => {
    const { repo: r } = repo({ tables: { users: { data: null, error: null } } });

    expect(await r.getCounterpart(direct, 'u_me')).toMatchObject({ isDeleted: true });
  });

  it('is not a deleted user for a support thread, which has no counterpart to show', async () => {
    const { repo: r, calls } = repo({});

    const counterpart = await r.getCounterpart({ ...direct, isSupportThread: true, participantIds: ['u_me', null] }, 'u_me');

    expect(counterpart).toMatchObject({ userId: null, isDeleted: false });
    expect(calls).toHaveLength(0);
  });
});
