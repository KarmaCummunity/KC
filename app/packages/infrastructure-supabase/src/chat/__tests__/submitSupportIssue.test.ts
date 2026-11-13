// FR-MOD-002: a support issue is one server call that files a system message and returns the thread.
import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { submitSupportIssue } from '../submitSupportIssue';

const SUPPORT_ROW = {
  id: 'c_s',
  kind: 'support',
  direct_user_a: null,
  direct_user_b: null,
  support_user_id: 'u_me',
  anchor_post_id: null,
  last_message_at: '2026-05-16T11:00:01.000Z',
  created_at: '2026-05-16T11:00:00.000Z',
};

describe('submitSupportIssue', () => {
  it('files the issue through submit_support_issue and returns the support thread', async () => {
    const { client, calls } = createFakeClient({ rpc: { submit_support_issue: { data: SUPPORT_ROW, error: null } } });

    const chat = await submitSupportIssue(client, ' Bug ', 'It crashes on start');

    expect(calls.map((c) => c.fn)).toEqual(['submit_support_issue']);
    expect(calls[0]?.args).toEqual({ p_category: 'Bug', p_description: 'It crashes on start' });
    expect(chat).toMatchObject({ chatId: 'c_s', isSupportThread: true });
  });

  it.each([[null], [''], ['   ']])('sends no category when none is chosen (%j)', async (category) => {
    const { client, calls } = createFakeClient({ rpc: { submit_support_issue: { data: [SUPPORT_ROW], error: null } } });

    await submitSupportIssue(client, category, 'It crashes on start');

    expect(calls[0]?.args).toEqual({ p_category: '', p_description: 'It crashes on start' });
  });

  it.each([
    ['description_too_long', 'description_too_long'],
    ['description_too_short', 'description_too_short'],
    ['rate_limited', 'rate_limited'],
  ])('maps the server refusal %s to the chat error %s', async (reason, code) => {
    const { client } = createFakeClient({
      rpc: { submit_support_issue: { data: null, error: { code: 'P0001', message: reason } } },
    });

    await expect(submitSupportIssue(client, null, 'It crashes on start')).rejects.toMatchObject({ code });
  });

  it('reports a missing submit_support_issue as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { submit_support_issue: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });

    await expect(submitSupportIssue(client, null, 'It crashes on start')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
