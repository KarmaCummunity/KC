// FR-MOD-008: the review queue adapter reads open entries oldest first and calls the two staff RPCs.
import { describe, expect, it } from 'vitest';
import { ModerationError, ModerationForbiddenError } from '@kc/application';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseModerationQueueRepository } from '../SupabaseModerationQueueRepository';

const ROW = {
  id: 'q1', target_type: 'post', target_id: 'p1', reason: 'excessive_reopens', assignee_id: null,
  metadata: { reopen_count: 5 }, created_at: '2026-11-11T10:00:00+00:00',
};

describe('SupabaseModerationQueueRepository', () => {
  it('reads the open entries, oldest first, and maps them', async () => {
    const { client, calls } = createFakeClient({ tables: { moderation_queue: { data: [ROW], error: null } } });

    const page = await new SupabaseModerationQueueRepository(client).listOpen(null, 30);

    expect(calls[0]?.filters).toEqual([
      ['eq', 'status', 'open'], ['order', 'created_at', { ascending: true }], ['order', 'id', { ascending: true }],
      ['limit', 30],
    ]);
    expect(page).toEqual({
      entries: [{
        entryId: 'q1', targetType: 'post', targetId: 'p1', reason: 'excessive_reopens', assigneeId: null,
        metadata: { reopen_count: 5 }, createdAt: '2026-11-11T10:00:00+00:00',
      }],
      nextCursor: null,
    });
  });

  it('continues after the cursor and returns one when the page is full', async () => {
    const { client, calls } = createFakeClient({ tables: { moderation_queue: { data: [ROW], error: null } } });

    const page = await new SupabaseModerationQueueRepository(client).listOpen(
      { createdAt: '2026-11-11T09:00:00+00:00', entryId: 'q0' }, 1);

    expect(calls[0]?.filters).toContainEqual(['or',
      'created_at.gt."2026-11-11T09:00:00+00:00",and(created_at.eq."2026-11-11T09:00:00+00:00",id.gt.q0)']);
    expect(page.nextCursor).toEqual({ createdAt: '2026-11-11T10:00:00+00:00', entryId: 'q1' });
  });

  it('skips an entry of a kind this build does not know', async () => {
    const { client } = createFakeClient({
      tables: { moderation_queue: { data: [{ ...ROW, reason: 'future_reason' }], error: null } },
    });
    expect((await new SupabaseModerationQueueRepository(client).listOpen(null, 30)).entries).toEqual([]);
  });

  it('assigns (to the caller or to someone) and resolves through the staff RPCs', async () => {
    const { client, calls } = createFakeClient();
    const repo = new SupabaseModerationQueueRepository(client);

    await repo.assign('q1');
    await repo.assign('q1', 'u2');
    await repo.resolve('q1');

    expect(calls.map((c) => [c.fn, c.args])).toEqual([
      ['admin_assign_queue_entry', { p_entry_id: 'q1' }],
      ['admin_assign_queue_entry', { p_entry_id: 'q1', p_assignee_id: 'u2' }],
      ['admin_resolve_queue_entry', { p_entry_id: 'q1' }],
    ]);
  });

  it('maps a closed entry and a non-moderator to moderation errors', async () => {
    const closed = createFakeClient({
      rpc: { admin_resolve_queue_entry: { data: null, error: { code: 'P0001', message: 'queue_entry_not_open' } } },
    });
    const support = createFakeClient({
      rpc: { admin_assign_queue_entry: { data: null, error: { code: '42501', message: 'forbidden' } } },
    });

    await expect(new SupabaseModerationQueueRepository(closed.client).resolve('q1'))
      .rejects.toEqual(expect.objectContaining({ code: 'queue_entry_not_open' }));
    await expect(new SupabaseModerationQueueRepository(closed.client).resolve('q1')).rejects.toBeInstanceOf(ModerationError);
    await expect(new SupabaseModerationQueueRepository(support.client).assign('q1'))
      .rejects.toBeInstanceOf(ModerationForbiddenError);
  });
});
