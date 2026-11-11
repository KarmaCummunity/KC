import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { submitSupportIssue, supportIssueBody } from '../submitSupportIssue';

const SUPPORT_ROW = {
  id: 'c_s',
  kind: 'support',
  direct_user_a: null,
  direct_user_b: null,
  support_user_id: 'u_me',
  anchor_post_id: null,
  last_message_at: null,
  created_at: '2026-05-16T11:00:00.000Z',
};

describe('supportIssueBody', () => {
  it('puts the category on the first line and the description after a blank line', () => {
    expect(supportIssueBody('Bug', 'It crashes')).toBe('Bug\n\nIt crashes');
  });

  it.each([[null], [''], ['   ']])('is the description alone without a category (%j)', (category) => {
    expect(supportIssueBody(category, 'It crashes')).toBe('It crashes');
  });
});

describe('submitSupportIssue', () => {
  it('opens the support thread, sends the issue into it and returns the thread', async () => {
    const { client, calls } = createFakeClient({
      rpc: { open_support_thread: { data: SUPPORT_ROW, error: null }, send_message: { data: {}, error: null } },
    });

    const chat = await submitSupportIssue(client, 'Bug', 'It crashes on start');

    expect(calls.map((c) => c.fn)).toEqual(['open_support_thread', 'send_message']);
    expect(calls[1]?.args).toEqual({ p_chat_id: 'c_s', p_body: 'Bug\n\nIt crashes on start' });
    expect(chat).toMatchObject({ chatId: 'c_s', isSupportThread: true });
  });

  it('does not send anything when the thread cannot be opened', async () => {
    const { client, calls } = createFakeClient({
      rpc: { open_support_thread: { data: null, error: { code: '42501', message: 'unauthenticated' } } },
    });

    await expect(submitSupportIssue(client, null, 'It crashes on start')).rejects.toMatchObject({ code: 'chat_forbidden' });
    expect(calls.map((c) => c.fn)).toEqual(['open_support_thread']);
  });

  it('maps a rate limit on the message to rate_limited', async () => {
    const { client } = createFakeClient({
      rpc: {
        open_support_thread: { data: SUPPORT_ROW, error: null },
        send_message: { data: null, error: { code: 'P0001', message: 'rate_limited' } },
      },
    });

    await expect(submitSupportIssue(client, null, 'It crashes on start')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('reports a missing send_message as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: {
        open_support_thread: { data: SUPPORT_ROW, error: null },
        send_message: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } },
      },
    });

    await expect(submitSupportIssue(client, null, 'It crashes on start')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
