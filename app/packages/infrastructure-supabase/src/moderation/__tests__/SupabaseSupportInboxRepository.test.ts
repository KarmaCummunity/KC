// FR-CHAT-007 / FR-MOD-002 / FR-ADMIN-013 AC2: the staff support inbox adapter.
import { describe, expect, it } from 'vitest';
import { ChatError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseSupportInboxRepository } from '../SupabaseSupportInboxRepository';

const THREAD = {
  chat_id: 'c1', member_id: 'u1', member_display_name: 'Dana', member_avatar_url: null,
  last_message_at: '2026-11-11T10:00:00Z', created_at: '2026-11-10T10:00:00Z', joined: false,
};
const CHAT = { id: 'c1', kind: 'support', support_user_id: 'u1' };

describe('SupabaseSupportInboxRepository', () => {
  it('lists a page of threads and hands back a cursor when the page is full', async () => {
    const { client, calls } = createFakeClient({ rpc: { admin_list_support_threads: { data: [THREAD], error: null } } });

    const page = await new SupabaseSupportInboxRepository(client).listThreads(null, 1);

    expect(calls[0]).toMatchObject({ fn: 'admin_list_support_threads', args: { p_limit: 1 } });
    expect(page.threads).toEqual([{
      chatId: 'c1', memberId: 'u1', memberDisplayName: 'Dana', memberAvatarUrl: null,
      lastMessageAt: '2026-11-11T10:00:00Z', joined: false,
    }]);
    expect(page.nextCursor).toEqual({ lastMessageAt: '2026-11-11T10:00:00Z', chatId: 'c1' });
  });

  it('passes the cursor on and stops after a short page', async () => {
    const { client, calls } = createFakeClient({ rpc: { admin_list_support_threads: { data: [THREAD], error: null } } });

    const page = await new SupabaseSupportInboxRepository(client).listThreads(
      { lastMessageAt: '2026-11-12T10:00:00Z', chatId: 'c0' }, 30);

    expect(calls[0]?.args).toEqual({ p_before_last_message_at: '2026-11-12T10:00:00Z', p_before_id: 'c0', p_limit: 30 });
    expect(page.nextCursor).toBeNull();
  });

  it('joins a thread and opens a member thread, returning the chat id', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        admin_join_support_thread: { data: CHAT, error: null },
        admin_open_member_support_thread: { data: [CHAT], error: null },
      },
    });
    const repo = new SupabaseSupportInboxRepository(client);

    await expect(repo.joinThread('c1')).resolves.toBe('c1');
    await expect(repo.openMemberThread('u1')).resolves.toBe('c1');
    expect(calls.map((c) => [c.fn, c.args])).toEqual([
      ['admin_join_support_thread', { p_chat_id: 'c1' }],
      ['admin_open_member_support_thread', { p_user_id: 'u1' }],
    ]);
  });

  it('maps a refused member to chat_forbidden and a missing function to BackendUnavailableError', async () => {
    const refused = createFakeClient({
      rpc: { admin_join_support_thread: { data: null, error: { code: '42501', message: 'forbidden' } } },
    });
    const missing = createFakeClient({
      rpc: { admin_list_support_threads: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });

    const error = await new SupabaseSupportInboxRepository(refused.client).joinThread('c1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({ code: 'chat_forbidden' });
    await expect(new SupabaseSupportInboxRepository(missing.client).listThreads(null, 30))
      .rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
