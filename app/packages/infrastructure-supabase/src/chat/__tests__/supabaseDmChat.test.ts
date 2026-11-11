import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient, type FakeError } from '../../__tests__/fakeBaselineClient';
import { hideChat, openDirectChat, openSupportThread } from '../supabaseDmChat';

const CHAT_ROW = {
  id: 'c_1',
  kind: 'direct',
  direct_user_a: 'u_a',
  direct_user_b: 'u_b',
  support_user_id: null,
  anchor_post_id: null,
  last_message_at: null,
  created_at: '2026-05-16T11:00:00.000Z',
  moderation_hidden_at: null,
};

const rpcClient = (fn: string, data: unknown, error: FakeError = null) =>
  createFakeClient({ rpc: { [fn]: { data, error } } });

describe('openDirectChat', () => {
  it('calls open_direct_chat with the other member and no anchor', async () => {
    const { client, calls } = rpcClient('open_direct_chat', CHAT_ROW);

    const chat = await openDirectChat(client, 'u_b');

    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'open_direct_chat', args: { p_user_id: 'u_b', p_anchor_post_id: undefined } });
    expect(chat).toMatchObject({ chatId: 'c_1', participantIds: ['u_a', 'u_b'], anchorPostId: null });
  });

  it('pins the chat to a post anchor', async () => {
    const { client, calls } = rpcClient('open_direct_chat', { ...CHAT_ROW, anchor_post_id: 'p_1' });

    const chat = await openDirectChat(client, 'u_b', { postId: 'p_1' });

    expect(calls[0]?.args).toEqual({ p_user_id: 'u_b', p_anchor_post_id: 'p_1' });
    expect(chat.anchorPostId).toBe('p_1');
  });

  it('accepts the chat row as a one-element array', async () => {
    const chat = await openDirectChat(rpcClient('open_direct_chat', [CHAT_ROW]).client, 'u_b');

    expect(chat.chatId).toBe('c_1');
  });

  it.each([
    ['user_unavailable', 'send_to_deleted_user'],
    ['blocked_relationship', 'blocked_relationship'],
    ['cannot_chat_self', 'cannot_chat_self'],
    ['post_unavailable', 'post_unavailable'],
    ['account_not_active', 'account_not_active'],
  ])('maps the refusal %s to ChatError %s', async (reason, code) => {
    const { client } = rpcClient('open_direct_chat', null, { code: 'P0001', message: reason });

    await expect(openDirectChat(client, 'u_b')).rejects.toMatchObject({ code });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = rpcClient('open_direct_chat', null, { code: 'PGRST202', message: 'not in the schema cache' });

    await expect(openDirectChat(client, 'u_b')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('fails when the server returns no chat', async () => {
    await expect(openDirectChat(rpcClient('open_direct_chat', null).client, 'u_b')).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('openSupportThread', () => {
  it('calls open_support_thread without arguments and maps the thread', async () => {
    const row = { ...CHAT_ROW, kind: 'support', direct_user_a: null, direct_user_b: null, support_user_id: 'u_me' };
    const { client, calls } = rpcClient('open_support_thread', row);

    const chat = await openSupportThread(client);

    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'open_support_thread' });
    expect(chat).toMatchObject({ isSupportThread: true, participantIds: ['u_me', null] });
  });

  it('maps a signed-out caller to chat_forbidden', async () => {
    const { client } = rpcClient('open_support_thread', null, { code: '42501', message: 'unauthenticated' });

    await expect(openSupportThread(client)).rejects.toMatchObject({ code: 'chat_forbidden' });
  });
});

describe('hideChat', () => {
  it('calls hide_chat with the chat id', async () => {
    const { client, calls } = rpcClient('hide_chat', null);

    await hideChat(client, 'c_1');

    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'hide_chat', args: { p_chat_id: 'c_1' } });
  });

  it('maps support_thread_not_hideable', async () => {
    const { client } = rpcClient('hide_chat', null, { code: 'P0001', message: 'support_thread_not_hideable' });

    await expect(hideChat(client, 'c_1')).rejects.toMatchObject({ code: 'support_thread_not_hideable' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = rpcClient('hide_chat', null, { code: '42883', message: 'function does not exist' });

    await expect(hideChat(client, 'c_1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
